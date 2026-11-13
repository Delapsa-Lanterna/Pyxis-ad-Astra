use crate::diagnostics;
use crate::errors::{AppError, AppResult, ErrorDiagnostic};
use crate::io::FsRootBoundary;
use crate::models;
use crate::models::{
    CloseScope, EditWriteTarget, ManagedWindowContext, ManagedWindowInput, ManagedWindowRequest,
    ManagedWindowStatus, WindowBootstrap, WindowIdentity, WindowRequestReceipt,
    WindowRequestStatus, WindowSaveAction, WindowSaveMessage, WindowSaveReply, WindowSaveRequest,
};
use crate::services::project;
use serde_json::Value;
#[cfg(windows)]
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::slice;
use std::sync::{Condvar, LazyLock, Mutex, MutexGuard};
#[cfg(windows)]
use tauri::WebviewWindow;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    ICoreWebView2_19,
};
#[cfg(windows)]
use windows_core::Interface;

#[cfg(windows)]
pub fn set_window_memory_target(window: &WebviewWindow, active: bool) {
    let label = window.label().to_string();
    let code = "window.memory_target_failed";
    if let Err(error) = window.with_webview(move |platform| {
        let level = if active {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        };
        let result = unsafe { platform.controller().CoreWebView2() }
            .and_then(|core| core.cast::<ICoreWebView2_19>())
            .and_then(|core| unsafe {
                core.SetMemoryUsageTargetLevel(level)?;
                let mut actual = level;
                core.MemoryUsageTargetLevel(&mut actual)?;
                diagnostics::debug("window.memory_target", || {
                    format!("window={label} active={active} level={}", actual.0)
                });
                Ok(())
            });
        if let Err(error) = result {
            diagnostics::failure(
                code,
                AppError::message(code, error.to_string()),
                json!({"window":label}),
            );
        }
    }) {
        diagnostics::failure(code, error, json!({"window":window.label()}));
    }
}

#[cfg(windows)]
pub mod auxiliary {
    use crate::errors::{AppError, AppResult};
    #[cfg(test)]
    use std::{mem, ptr};
    #[cfg(test)]
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;

    use std::io::Error;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    struct Installation {
        single_class: String,
        result: AppResult<()>,
    }

    /// Installs auxiliary-window protection on the application's GUI thread.
    pub fn install(identifier: &str) -> AppResult<()> {
        let mut state = Installation {
            single_class: format!("{identifier}-sic"),
            result: Ok(()),
        };
        // Enumeration and subclass installation run on the owning thread.
        let complete = unsafe {
            EnumThreadWindows(
                GetCurrentThreadId(),
                Some(attach),
                &mut state as *mut _ as LPARAM,
            )
        };
        state.result?;
        if complete == 0 {
            return Err(AppError::context(
                "enumerate GUI windows",
                Error::last_os_error().into(),
            ));
        }
        Ok(())
    }

    unsafe extern "system" fn attach(window: HWND, data: LPARAM) -> i32 {
        let state = unsafe { &mut *(data as *mut Installation) };
        let mut name = [0u16; 256];
        let length = unsafe { GetClassNameW(window, name.as_mut_ptr(), name.len() as i32) };
        if length == 0 {
            state.result = Err(AppError::context(
                "read window class",
                Error::last_os_error().into(),
            ));
            return 0;
        }
        let class = String::from_utf16_lossy(&name[..length as usize]);
        if (class == "Tao Thread Event Target" || class == state.single_class)
            && unsafe { SetWindowSubclass(window, Some(protect), 0, 0) } == 0
        {
            state.result = Err(AppError::message(
                "window.auxiliary_protection_failed",
                format!("install close protection: {class}"),
            ));
            return 0;
        }
        1
    }

    unsafe extern "system" fn protect(
        window: HWND,
        message: u32,
        w: WPARAM,
        l: LPARAM,
        id: usize,
        _: usize,
    ) -> LRESULT {
        if message == WM_CLOSE || (message == WM_SYSCOMMAND && w & 0xfff0 == SC_CLOSE as usize) {
            return 0;
        }
        // Runtime-owned DestroyWindow remains authoritative during shutdown.
        if message == WM_NCDESTROY {
            unsafe { RemoveWindowSubclass(window, Some(protect), id) };
        }
        unsafe { DefSubclassProc(window, message, w, l) }
    }

    #[test]
    fn auxiliary_close_keeps_runtime() {
        unsafe {
            let instance = GetModuleHandleW(ptr::null());
            let mut windows = Vec::new();
            for name in [
                "Tao Thread Event Target",
                "guard.fixture-sic",
                "guard.unrelated",
            ] {
                let class = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
                let definition = WNDCLASSW {
                    hInstance: instance,
                    lpfnWndProc: Some(DefWindowProcW),
                    lpszClassName: class.as_ptr(),
                    ..mem::zeroed()
                };
                assert_ne!(RegisterClassW(&definition), 0);
                let window = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    instance,
                    ptr::null(),
                );
                assert!(!window.is_null());
                windows.push((window, class));
            }
            install("guard.fixture").unwrap();
            install("guard.fixture").unwrap();
            for (index, (window, class)) in windows.iter().enumerate() {
                SendMessageW(*window, WM_SYSCOMMAND, SC_CLOSE as usize, 0);
                SendMessageW(*window, WM_CLOSE, 0, 0);
                assert_eq!(IsWindow(*window) != 0, index < 2);
                if index < 2 {
                    assert_eq!(
                        SendMessageW(*window, WM_GETTEXTLENGTH, 0, 0),
                        (class.len() - 1) as isize
                    );
                    assert_ne!(DestroyWindow(*window), 0);
                    assert_eq!(IsWindow(*window), 0);
                }
            }
            for (_, class) in windows {
                assert_ne!(UnregisterClassW(class.as_ptr(), instance), 0);
            }
        }
    }
}

#[derive(Default)]
struct WindowRegistry {
    save_receivers: BTreeMap<String, (u64, Channel<WindowSaveMessage>)>,
    save_requests: BTreeMap<u64, PendingSaveRequest>,
    request_sequence: u64,
    requests: BTreeMap<u64, PendingWindowRequest>,
    edit_targets: BTreeMap<String, Vec<EditWriteTarget>>,
    sequence: u64,
    identities: BTreeMap<WindowIdentity, String>,
    instances: BTreeMap<String, WindowInstance>,
    reservations: BTreeMap<WindowIdentity, String>,
    closing: BTreeMap<u64, (String, CloseScope, Vec<String>)>,
}
struct PendingSaveRequest {
    owner: String,
    receiver: String,
    message: WindowSaveMessage,
    result: Option<Result<WindowSaveReply, ErrorDiagnostic>>,
}

struct PendingWindowRequest {
    owner: Option<String>,
    label: String,
    result: Option<Result<WindowRequestReceipt, ErrorDiagnostic>>,
}

pub(crate) struct OpenedWindow {
    pub(crate) label: String,
    pub(crate) request_id: u64,
}

struct WindowInstance {
    title: String,
    input: ManagedWindowInput,
    accepted_input: Option<(u64, ManagedWindowInput)>,
    active: Option<(u64, ManagedWindowInput)>,
    receiver_generation: u64,
    revision: u64,
    request_id: u64,
    identity: WindowIdentity,
    creating: bool,
    status: ManagedWindowStatus,
}

impl WindowRegistry {
    fn edit_target_owners(&self, targets: &[EditWriteTarget]) -> Vec<String> {
        self.edit_targets
            .iter()
            .filter(|(_, registered)| {
                registered.iter().any(|own| {
                    targets
                        .iter()
                        .any(|target| edit_targets_overlap(own, target))
                })
            })
            .map(|(label, _)| label.clone())
            .collect()
    }
    fn focus_target(&self, caller: &str, identity: &WindowIdentity) -> Option<String> {
        self.identities
            .get(&identity.comparison_key())
            .filter(|label| label.as_str() != caller)
            .cloned()
    }
    fn register(
        &mut self,
        identity: WindowIdentity,
        title: String,
        input: ManagedWindowInput,
    ) -> String {
        self.sequence += 1;
        let label = format!("managed-{}", self.sequence);
        self.identities
            .insert(identity.comparison_key(), label.clone());
        self.instances.insert(
            label.clone(),
            WindowInstance {
                title,
                input,
                accepted_input: None,
                active: None,
                receiver_generation: 0,
                revision: 0,
                request_id: 0,
                identity,
                creating: true,
                status: Default::default(),
            },
        );
        label
    }
    fn release(&mut self, label: &str) {
        self.release_save_receiver(label);
        let ended = self
            .requests
            .iter()
            .filter(|(_, request)| request.label == label && request.result.is_none())
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in ended {
            self.complete(id, WindowRequestStatus::Cancelled);
        }
        for request in self.requests.values_mut() {
            if request.owner.as_deref() == Some(label) {
                request.owner = None;
            }
        }
        self.requests
            .retain(|_, request| request.owner.is_some() || request.result.is_none());
        self.edit_targets.remove(label);
        if let Some(instance) = self.instances.remove(label) {
            self.identities.remove(&instance.identity.comparison_key());
        }
        self.reservations.retain(|_, owner| owner != label);
    }

    fn release_save_receiver(&mut self, label: &str) {
        self.save_receivers.remove(label);
        for pending in self
            .save_requests
            .values_mut()
            .filter(|pending| pending.owner == label || pending.receiver == label)
        {
            pending.result.get_or_insert_with(|| {
                Err(AppError::message("window.released", "保存窗口已释放").diagnostic())
            });
        }
    }

    fn register_save_receiver(&mut self, label: &str, channel: Channel<WindowSaveMessage>) -> u64 {
        self.release_save_receiver(label);
        self.request_sequence += 1;
        self.save_receivers
            .insert(label.into(), (self.request_sequence, channel));
        self.request_sequence
    }

    fn receive_save(
        &mut self,
        owner: &str,
        receiver: &str,
        request: WindowSaveRequest,
    ) -> AppResult<WindowSaveMessage> {
        if (matches!(request.action, WindowSaveAction::Batch) && receiver != "main")
            || (!matches!(request.action, WindowSaveAction::Batch) && owner != "main")
        {
            return Err(AppError::message(
                "window.save_owner",
                "保存请求不属于主窗口",
            ));
        }
        for label in [owner, receiver]
            .into_iter()
            .filter(|label| *label != "main")
        {
            if self.instances.get(label).is_none_or(|instance| {
                instance.identity.session_id() != Some(request.target.session_id.as_str())
                    || instance.identity.mod_root().map(models::windows_path_key)
                        != Some(models::windows_path_key(&request.target.mod_root))
            }) {
                return Err(AppError::message(
                    "window.save_target",
                    "保存窗口的项目已变化",
                ));
            }
        }
        let generation = self
            .save_receivers
            .get(receiver)
            .ok_or_else(|| AppError::message("window.released", "保存窗口尚未就绪"))?
            .0;
        self.request_sequence += 1;
        let message = WindowSaveMessage {
            request_id: self.request_sequence,
            receiver_generation: generation,
            request,
        };
        self.save_requests.insert(
            message.request_id,
            PendingSaveRequest {
                owner: owner.into(),
                receiver: receiver.into(),
                message: message.clone(),
                result: None,
            },
        );
        Ok(message)
    }

    fn finish_save(
        &mut self,
        receiver: &str,
        id: u64,
        generation: u64,
        result: Result<WindowSaveReply, ErrorDiagnostic>,
    ) {
        if let Some(pending) = self.save_requests.get_mut(&id)
            && pending.receiver == receiver
            && pending.message.receiver_generation == generation
            && self
                .save_receivers
                .get(receiver)
                .is_some_and(|(current, _)| *current == generation)
            && pending.result.is_none()
        {
            pending.result = Some(result);
        }
    }

    fn receive(&mut self, label: &str, owner: &str, input: ManagedWindowInput) -> u64 {
        let previous = self.instances[label].request_id;
        if self.instances[label]
            .active
            .as_ref()
            .is_none_or(|(id, _)| *id != previous)
        {
            self.complete(previous, WindowRequestStatus::Superseded);
        }
        self.request_sequence += 1;
        let id = self.request_sequence;
        let instance = self
            .instances
            .get_mut(label)
            .expect("request window is registered");
        instance.input = input;
        instance.revision += 1;
        instance.request_id = id;
        self.requests.insert(
            id,
            PendingWindowRequest {
                owner: Some(owner.into()),
                label: label.into(),
                result: None,
            },
        );
        id
    }
    fn complete(&mut self, id: u64, status: WindowRequestStatus) {
        if let Some(request) = self.requests.get_mut(&id)
            && request.result.is_none()
        {
            request.result = Some(Ok(WindowRequestReceipt {
                label: request.label.clone(),
                request_id: id,
                status,
            }));
        }
        self.requests
            .retain(|_, request| request.owner.is_some() || request.result.is_none());
    }
    fn context(&self, label: &str, pending: bool) -> AppResult<ManagedWindowContext> {
        let instance = self
            .instances
            .get(label)
            .ok_or_else(|| AppError::message("window.released", "窗口已释放"))?;
        Ok(ManagedWindowContext {
            kind: instance.input.kind(),
            label: label.into(),
            receiver_generation: instance.receiver_generation,
            revision: instance.revision,
            request_id: if pending {
                instance.request_id
            } else {
                instance
                    .accepted_input
                    .as_ref()
                    .map_or(instance.request_id, |(id, _)| *id)
            },
            identity: instance.identity.clone(),
            title: instance.title.clone(),
            input: if pending {
                instance.input.clone()
            } else {
                instance
                    .accepted_input
                    .as_ref()
                    .map(|(_, input)| input)
                    .unwrap_or(&instance.input)
                    .clone()
            },
        })
    }
    fn claim(&mut self, label: &str) -> AppResult<Option<ManagedWindowContext>> {
        let instance = self
            .instances
            .get_mut(label)
            .ok_or_else(|| AppError::message("window.released", "窗口已释放"))?;
        if instance.active.is_none()
            && self
                .requests
                .get(&instance.request_id)
                .is_some_and(|request| request.result.is_none())
        {
            instance.active = Some((instance.request_id, instance.input.clone()));
        }
        let Some((id, input)) = instance.active.clone() else {
            return Ok(None);
        };
        let mut context = self.context(label, true)?;
        context.request_id = id;
        context.input = input;
        Ok(Some(context))
    }
    fn accept(&mut self, label: &str, id: u64, receiver_generation: u64) -> AppResult<bool> {
        let instance = self
            .instances
            .get_mut(label)
            .ok_or_else(|| AppError::message("window.released", "窗口已释放"))?;
        if instance
            .active
            .as_ref()
            .is_none_or(|(active, _)| *active != id)
            || instance.receiver_generation != receiver_generation
        {
            return Ok(false);
        }
        if self
            .requests
            .get(&id)
            .is_none_or(|request| request.result.is_some())
        {
            return Ok(false);
        }
        instance.accepted_input = instance.active.take();
        self.complete(id, WindowRequestStatus::Accepted);
        Ok(true)
    }
    fn fail(&mut self, label: &str, id: u64, diagnostic: ErrorDiagnostic) -> AppResult<()> {
        if !self.instances.contains_key(label) {
            return Err(AppError::message("window.released", "窗口已释放"));
        }
        if let Some(instance) = self.instances.get_mut(label)
            && instance
                .active
                .as_ref()
                .is_some_and(|(active, _)| *active == id)
        {
            instance.active = None;
        }
        if let Some(request) = self.requests.get_mut(&id)
            && request.label == label
            && request.result.is_none()
        {
            request.result = Some(Err(diagnostic));
        }
        self.requests
            .retain(|_, request| request.owner.is_some() || request.result.is_none());
        Ok(())
    }

    fn conflict(&self, label: &str, identities: &[WindowIdentity]) -> Option<String> {
        identities.iter().find_map(|identity| {
            let key = identity.comparison_key();
            self.reservations
                .get(&key)
                .filter(|owner| owner.as_str() != label)
                .cloned()
                .or_else(|| {
                    let WindowIdentity::TextEditor {
                        session_id,
                        mod_root,
                        path,
                    } = identity
                    else {
                        return None;
                    };
                    let target = EditWriteTarget {
                        session_id: session_id.clone(),
                        mod_root: mod_root.clone(),
                        path: path.clone(),
                    };
                    self.edit_target_owners(slice::from_ref(&target))
                        .into_iter()
                        .find(|owner| {
                            owner != label
                                && self.instances.get(owner).is_some_and(|instance| {
                                    instance.status.dirty || instance.status.saving
                                })
                        })
                })
                .or_else(|| {
                    self.identities
                        .get(&key)
                        .filter(|owner| owner.as_str() != label)
                        .filter(|owner| {
                            self.instances.get(*owner).is_some_and(|instance| {
                                instance.status.dirty || instance.status.saving || instance.creating
                            })
                        })
                        .cloned()
                })
        })
    }
    fn reserve(&mut self, label: &str, identities: &[WindowIdentity]) -> Result<(), String> {
        if let Some(conflict) = self.conflict(label, identities) {
            return Err(conflict);
        }
        for identity in identities {
            self.reservations
                .insert(identity.comparison_key(), label.to_string());
        }
        Ok(())
    }
    fn retarget(&mut self, label: &str, identity: WindowIdentity) {
        let instance = self
            .instances
            .get_mut(label)
            .expect("retargeted window is registered");
        self.identities.remove(&instance.identity.comparison_key());
        instance.identity = identity;
        instance.revision += 1;
        instance.input.retarget(&instance.identity);
        if let Some((_, input)) = &mut instance.active {
            input.retarget(&instance.identity);
        }
        if let Some((_, input)) = &mut instance.accepted_input {
            input.retarget(&instance.identity);
        }
        self.identities
            .insert(instance.identity.comparison_key(), label.to_string());
    }

    fn replace_input(&mut self, label: &str, input: ManagedWindowInput) {
        let instance = self
            .instances
            .get_mut(label)
            .expect("retargeted window is registered");
        instance.input = input.clone();
        if let Some((_, active)) = &mut instance.active {
            *active = input.clone();
        }
        if let Some((_, accepted)) = &mut instance.accepted_input {
            *accepted = input;
        }
    }
}

static REGISTRY: LazyLock<(Mutex<WindowRegistry>, Condvar)> =
    LazyLock::new(|| (Mutex::new(WindowRegistry::default()), Condvar::new()));
fn registry() -> AppResult<MutexGuard<'static, WindowRegistry>> {
    REGISTRY
        .0
        .lock()
        .map_err(|_| AppError::message("window.registry_poisoned", "窗口登记状态不可用"))
}

pub(crate) fn register_window_request(
    app: &AppHandle,
    owner: &str,
    request: ManagedWindowRequest,
) -> AppResult<OpenedWindow> {
    if !request.input.matches(&request.identity) {
        return Err(AppError::message(
            "window.input_identity_mismatch",
            "窗口输入与身份不匹配",
        ));
    }
    authorize_identity(&request.identity)?;
    let native_theme =
        matches!(&request.identity, WindowIdentity::Immersive { .. }).then_some(Theme::Dark);
    let key = request.identity.comparison_key();
    let (opened, create, notify) = {
        let mut state = registry()?;
        if state
            .closing
            .values()
            .any(|(_, scope, labels)| match scope {
                CloseScope::Application => true,
                CloseScope::Sessions { session_ids } => request
                    .identity
                    .session_id()
                    .is_some_and(|id| session_ids.iter().any(|session| session == id)),
                CloseScope::Window => state
                    .identities
                    .get(&key)
                    .is_some_and(|label| labels.contains(label)),
            })
        {
            return Err(AppError::message(
                "window.scope_closing",
                "窗口范围正在关闭",
            ));
        }
        if let Some(owner) = state.reservations.get(&key).cloned() {
            drop(state);
            focus_window(app, &owner)?;
            return Err(AppError::message(
                "window.identity_reserved",
                format!("目标正在保存: {owner}"),
            ));
        }
        let existing = state.identities.get(&key).cloned();
        let create = existing.is_none();
        let label = existing.unwrap_or_else(|| {
            state.register(
                request.identity,
                request.title.clone(),
                request.input.clone(),
            )
        });
        let notify = !state.instances[&label].creating;
        let request_id = state.receive(&label, owner, request.input);
        diagnostics::debug("window.request_registered", || {
            format!(
                "window={label} requestId={request_id} created={create} receiverGeneration={} identity={:?}",
                state.instances[&label].receiver_generation, state.instances[&label].identity
            )
        });
        (OpenedWindow { label, request_id }, create, notify)
    };
    REGISTRY.1.notify_all();
    if !create {
        if notify {
            if let Err(error) = app.emit_to(
                &opened.label,
                "managed-window-request-available",
                opened.request_id,
            ) {
                registry()?.fail(
                    &opened.label,
                    opened.request_id,
                    AppError::Tauri(error).diagnostic(),
                )?;
                REGISTRY.1.notify_all();
            }
            if let Err(error) = focus_window(app, &opened.label) {
                registry()?.fail(&opened.label, opened.request_id, error.diagnostic())?;
                REGISTRY.1.notify_all();
            }
        }
        return Ok(opened);
    }
    let mut builder = WebviewWindowBuilder::new(app, &opened.label, WebviewUrl::App("/".into()))
        .title(request.title)
        .visible(false)
        .decorations(false)
        .theme(native_theme)
        .inner_size(request.width, request.height)
        .min_inner_size(request.min_width, request.min_height);
    // Windows sharing a WebView profile must use the same browser environment options.
    if let Some(arguments) = app
        .config()
        .app
        .windows
        .first()
        .and_then(|window| window.additional_browser_args.as_deref())
    {
        builder = builder.additional_browser_args(arguments);
    }
    let built = builder.build();
    let mut state = registry()?;
    match built {
        Ok(_window) => {
            #[cfg(windows)]
            set_window_memory_target(&_window, false);
            if let Some(instance) = state.instances.get_mut(&opened.label) {
                instance.creating = false;
            } else {
                return Ok(opened);
            }
            REGISTRY.1.notify_all();
        }
        Err(error) => {
            let diagnostic = AppError::Tauri(error).diagnostic();
            let pending = state
                .requests
                .iter()
                .filter(|(_, request)| request.label == opened.label && request.result.is_none())
                .map(|(id, _)| *id)
                .collect::<Vec<_>>();
            for id in pending {
                state.fail(&opened.label, id, diagnostic.clone())?;
            }
            state.release(&opened.label);
            REGISTRY.1.notify_all();
        }
    }
    Ok(opened)
}

pub fn current_window_bootstrap(label: &str) -> AppResult<WindowBootstrap> {
    if label == "main" {
        return Ok(WindowBootstrap::Main {
            windows_path_case_map: models::windows_path_case_map(),
        });
    }
    let mut state = registry()?;
    state
        .instances
        .get_mut(label)
        .expect("managed window is registered")
        .receiver_generation += 1;
    let instance = &state.instances[label];
    if instance.accepted_input.is_none()
        && instance.active.is_none()
        && state
            .requests
            .get(&instance.request_id)
            .is_none_or(|request| request.result.is_some())
    {
        let input = instance.input.clone();
        let id = state.receive(label, label, input);
        state
            .requests
            .get_mut(&id)
            .expect("retry request is registered")
            .owner = None;
    }
    let context = state.context(label, false)?;
    let restoring = state.instances[label].accepted_input.is_some();
    drop(state);
    let mod_name = match context.identity.session_id() {
        Some(session) => project::current_project_manifest(session)?
            .mod_info
            .and_then(|info| info.get("name").and_then(Value::as_str).map(str::to_owned)),
        None => None,
    }
    .unwrap_or_else(|| {
        context
            .identity
            .mod_root()
            .and_then(|root| Path::new(root).file_name())
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "未关联 Mod".into())
    });
    Ok(WindowBootstrap::Managed {
        windows_path_case_map: models::windows_path_case_map(),
        context: Box::new(context),
        restoring,
        mod_name,
    })
}
pub fn current_window_context(label: &str) -> AppResult<ManagedWindowContext> {
    registry()?.context(label, false)
}

pub(crate) fn accepts_save(label: &str, source_session: Option<&str>) -> AppResult<bool> {
    let registry = registry()?;
    let session = registry
        .instances
        .get(label)
        .and_then(|instance| instance.identity.session_id())
        .or(source_session);
    Ok(!registry
        .closing
        .values()
        .any(|(_, scope, labels)| match scope {
            CloseScope::Application => true,
            CloseScope::Sessions { session_ids } => {
                session.is_some_and(|session| session_ids.iter().any(|id| id == session))
            }
            CloseScope::Window => labels.iter().any(|closed| closed == label),
        }))
}
pub fn current_window_request(label: &str) -> AppResult<Option<ManagedWindowContext>> {
    let mut state = registry()?;
    state.claim(label)
}
pub fn accept_window_request(label: &str, id: u64, receiver_generation: u64) -> AppResult<bool> {
    let accepted = registry()?.accept(label, id, receiver_generation)?;
    REGISTRY.1.notify_all();
    Ok(accepted)
}
pub fn fail_window_request(
    label: &str,
    id: u64,
    receiver_generation: u64,
    diagnostic: ErrorDiagnostic,
) -> AppResult<()> {
    let mut state = registry()?;
    if state
        .instances
        .get(label)
        .is_some_and(|instance| instance.receiver_generation == receiver_generation)
    {
        state.fail(label, id, diagnostic)?;
    }
    REGISTRY.1.notify_all();
    Ok(())
}
pub fn fail_window_startup(label: &str, diagnostic: &ErrorDiagnostic) -> AppResult<()> {
    let mut state = registry()?;
    let pending: Vec<_> = state
        .requests
        .iter()
        .filter(|(_, request)| request.label == label && request.result.is_none())
        .map(|(id, _)| *id)
        .collect();
    for id in pending {
        state.fail(label, id, diagnostic.clone())?;
    }
    REGISTRY.1.notify_all();
    Ok(())
}
pub fn await_window_request(owner: &str, id: u64) -> Result<WindowRequestReceipt, ErrorDiagnostic> {
    let mut state = registry().map_err(|error| error.diagnostic())?;
    let request = state.requests.get(&id).ok_or_else(|| {
        AppError::message("window.request_missing", "窗口请求已结束").diagnostic()
    })?;
    if request.owner.as_deref() != Some(owner) {
        return Err(
            AppError::message("window.request_owner_mismatch", "窗口请求不属于当前调用方")
                .diagnostic(),
        );
    }
    let label = request.label.clone();
    loop {
        match state.requests.get_mut(&id) {
            Some(request) => {
                if request.owner.is_none() {
                    return Ok(WindowRequestReceipt {
                        label,
                        request_id: id,
                        status: WindowRequestStatus::Cancelled,
                    });
                }
                if let Some(result) = request.result.take() {
                    state.requests.remove(&id);
                    return result;
                }
            }
            None => {
                return Ok(WindowRequestReceipt {
                    label,
                    request_id: id,
                    status: WindowRequestStatus::Cancelled,
                });
            }
        }
        state = REGISTRY.1.wait(state).map_err(|_| {
            AppError::message("window.registry_poisoned", "窗口登记状态不可用").diagnostic()
        })?;
    }
}
pub fn release_window(label: &str) -> AppResult<()> {
    registry()?.release(label);
    REGISTRY.1.notify_all();
    Ok(())
}

pub fn register_save_receiver(label: &str, channel: Channel<WindowSaveMessage>) -> AppResult<u64> {
    let generation = registry()?.register_save_receiver(label, channel);
    REGISTRY.1.notify_all();
    Ok(generation)
}
pub fn unregister_save_receiver(label: &str, generation: u64) -> AppResult<()> {
    let mut state = registry()?;
    if state
        .save_receivers
        .get(label)
        .is_some_and(|(current, _)| *current == generation)
    {
        state.release_save_receiver(label);
    }
    REGISTRY.1.notify_all();
    Ok(())
}
pub fn request_window_save(
    app: &AppHandle,
    owner: &str,
    receiver: &str,
    request: WindowSaveRequest,
) -> AppResult<u64> {
    project::ensure_project_session_mod_root(&request.target.session_id, &request.target.mod_root)?;
    let focus = matches!(request.action, WindowSaveAction::Save { .. });
    let (message, channel) = {
        let mut state = registry()?;
        let message = state.receive_save(owner, receiver, request)?;
        (message, state.save_receivers[receiver].1.clone())
    };
    if focus && let Err(error) = focus_window(app, receiver) {
        registry()?.save_requests.remove(&message.request_id);
        return Err(error);
    }
    let id = message.request_id;
    if let Err(error) = channel.send(message.clone()) {
        reply_window_save(
            receiver,
            id,
            message.receiver_generation,
            None,
            Some(AppError::message("window.save_delivery", error.to_string()).diagnostic()),
        )?;
    }
    Ok(id)
}
pub fn await_window_save(owner: &str, id: u64) -> Result<WindowSaveReply, ErrorDiagnostic> {
    let mut state = registry().map_err(|error| error.diagnostic())?;
    loop {
        let pending = state
            .save_requests
            .get_mut(&id)
            .expect("save request is registered until its owner receives the result");
        if pending.owner != owner {
            return Err(
                AppError::message("window.save_owner", "保存请求不属于当前窗口").diagnostic(),
            );
        }
        if let Some(result) = pending.result.take() {
            state.save_requests.remove(&id);
            return result;
        }
        state = REGISTRY.1.wait(state).map_err(|_| {
            AppError::message("window.registry_poisoned", "窗口登记状态不可用").diagnostic()
        })?;
    }
}
pub fn reply_window_save(
    receiver: &str,
    id: u64,
    generation: u64,
    result: Option<WindowSaveReply>,
    diagnostic: Option<ErrorDiagnostic>,
) -> AppResult<()> {
    registry()?.finish_save(
        receiver,
        id,
        generation,
        diagnostic.map_or_else(
            || Ok(result.expect("successful save reply contains its result")),
            Err,
        ),
    );
    REGISTRY.1.notify_all();
    Ok(())
}

pub fn update_status(label: &str, status: ManagedWindowStatus) -> AppResult<()> {
    if let Some(instance) = registry()?.instances.get_mut(label) {
        instance.status = status;
    }
    REGISTRY.1.notify_all();
    Ok(())
}

pub fn update_edit_targets(label: &str, targets: Vec<EditWriteTarget>) -> AppResult<()> {
    for target in &targets {
        project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
        FsRootBoundary::new(Path::new(&target.mod_root), "edit target root")?
            .resolve_absolute(Path::new(&target.path), "edit target")?;
    }
    let mut state = registry()?;
    if label != "main" && !state.instances.contains_key(label) {
        return Err(AppError::message("window.released", "编辑窗口已释放"));
    }
    if targets.is_empty() {
        state.edit_targets.remove(label);
    } else {
        state.edit_targets.insert(label.into(), targets);
    }
    Ok(())
}

pub fn query_edit_target_owners(targets: &[EditWriteTarget]) -> AppResult<Vec<String>> {
    for target in targets {
        project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
    }
    let state = registry()?;
    Ok(state.edit_target_owners(targets))
}

pub fn project_source_paths(session_id: &str) -> AppResult<Vec<String>> {
    let state = registry()?;
    let mut paths = state
        .edit_targets
        .values()
        .flatten()
        .filter(|target| target.session_id == session_id)
        .map(|target| target.path.clone())
        .collect::<Vec<_>>();
    paths.extend(
        state
            .instances
            .values()
            .filter_map(|instance| match &instance.identity {
                WindowIdentity::TextEditor {
                    session_id: owner,
                    path,
                    ..
                } if owner == session_id => Some(path.clone()),
                _ => None,
            }),
    );
    Ok(paths)
}

fn edit_targets_overlap(left: &EditWriteTarget, right: &EditWriteTarget) -> bool {
    if left.session_id != right.session_id
        || models::windows_path_key(&left.mod_root) != models::windows_path_key(&right.mod_root)
    {
        return false;
    }
    let left = models::windows_path_key(&left.path);
    let right = models::windows_path_key(&right.path);
    left == right
        || left.starts_with(&format!("{right}/"))
        || right.starts_with(&format!("{left}/"))
}

pub fn reserve_edit_targets(
    app: &AppHandle,
    label: &str,
    targets: &[EditWriteTarget],
) -> AppResult<()> {
    for target in targets {
        project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
    }
    let identities = targets
        .iter()
        .map(|target| WindowIdentity::TextEditor {
            session_id: target.session_id.clone(),
            mod_root: target.mod_root.clone(),
            path: target.path.clone(),
        })
        .collect::<Vec<_>>();
    let conflict = registry()?.reserve(label, &identities).err();
    if let Some(conflict) = conflict {
        focus_window(app, &conflict)?;
        return Err(AppError::message(
            "window.target_unsaved",
            "编辑目标正在交接",
        ));
    }
    Ok(())
}

pub fn focus_edit_target_owner(app: &AppHandle, label: &str) -> AppResult<bool> {
    if !registry()?.edit_targets.contains_key(label) {
        return Ok(false);
    }
    focus_window(app, label)?;
    Ok(true)
}

pub fn reserve_targets(
    app: &AppHandle,
    label: &str,
    identities: &[WindowIdentity],
) -> AppResult<Vec<String>> {
    let displaced = {
        let mut state = registry()?;
        if let Err(conflict) = state.reserve(label, identities) {
            drop(state);
            focus_window(app, &conflict)?;
            return Err(AppError::message(
                "window.target_unsaved",
                "目标窗口有待保存内容，请先完成该窗口的编辑",
            ));
        }
        identities
            .iter()
            .filter_map(|identity| state.identities.get(&identity.comparison_key()))
            .filter(|owner| owner.as_str() != label)
            .cloned()
            .collect::<Vec<_>>()
    };
    Ok(displaced)
}

pub(crate) fn hold_close(
    id: u64,
    owner: &str,
    scope: &CloseScope,
    parent: Option<u64>,
) -> AppResult<Result<Vec<String>, u64>> {
    let mut state = registry()?;
    let mut labels: Vec<_> = state
        .instances
        .iter()
        .filter(|(label, instance)| match scope {
            CloseScope::Window => label.as_str() == owner,
            CloseScope::Sessions { session_ids } => instance
                .identity
                .session_id()
                .is_some_and(|id| session_ids.iter().any(|session| session == id)),
            CloseScope::Application => true,
        })
        .map(|(label, _)| label.clone())
        .collect();
    if *scope != CloseScope::Window {
        labels.insert(0, "main".into());
    }
    if let Some((blocking, _)) = state.closing.iter().find(|(id, (_, other, occupied))| {
        Some(**id) != parent
            && (scope.overlaps(other) || labels.iter().any(|label| occupied.contains(label)))
    }) {
        return Ok(Err(*blocking));
    }
    state
        .closing
        .insert(id, (owner.into(), scope.clone(), labels.clone()));
    Ok(Ok(labels))
}
pub(crate) fn release_close(id: u64) -> AppResult<()> {
    registry()?.closing.remove(&id);
    REGISTRY.1.notify_all();
    Ok(())
}
pub(crate) fn wait_ready(label: &str) -> AppResult<bool> {
    let mut state = registry()?;
    while state
        .instances
        .get(label)
        .is_some_and(|instance| instance.creating)
    {
        state = REGISTRY
            .1
            .wait(state)
            .map_err(|_| AppError::message("window.registry_poisoned", "窗口登记状态不可用"))?;
    }
    Ok(state.instances.contains_key(label))
}
pub fn release_session(session_id: &str) -> AppResult<()> {
    let mut state = registry()?;
    for pending in state
        .save_requests
        .values_mut()
        .filter(|pending| pending.message.request.target.session_id == session_id)
    {
        pending.result.get_or_insert_with(|| {
            Err(AppError::message("session.closed", "保存项目已关闭").diagnostic())
        });
    }
    REGISTRY.1.notify_all();
    state
        .edit_targets
        .values_mut()
        .for_each(|targets| targets.retain(|target| target.session_id != session_id));
    state.edit_targets.retain(|_, targets| !targets.is_empty());
    state
        .reservations
        .retain(|identity, _| identity.session_id() != Some(session_id));
    Ok(())
}

pub fn release_targets(label: &str) -> AppResult<()> {
    registry()?.reservations.retain(|_, owner| owner != label);
    Ok(())
}

pub fn retarget_window(
    app: &AppHandle,
    label: &str,
    identity: WindowIdentity,
    title: &str,
    input: Option<ManagedWindowInput>,
) -> AppResult<()> {
    if input
        .as_ref()
        .is_some_and(|input| !input.matches(&identity))
    {
        return Err(AppError::message(
            "window.input_identity_mismatch",
            "窗口输入与身份不匹配",
        ));
    }
    {
        let mut state = registry()?;
        if let Some(conflict) = state.conflict(label, slice::from_ref(&identity)) {
            drop(state);
            focus_window(app, &conflict)?;
            return Err(AppError::message(
                "window.target_unsaved",
                format!("目标窗口正在编辑: {conflict}"),
            ));
        }
        state.retarget(label, identity);
        if let Some(input) = input {
            state.replace_input(label, input);
        }
        state
            .instances
            .get_mut(label)
            .expect("retargeted window is registered")
            .title = title.to_string();
    }
    REGISTRY.1.notify_all();
    if let Some(window) = app.get_webview_window(label) {
        window.set_title(title)?;
    }
    Ok(())
}

fn focus_window(app: &AppHandle, label: &str) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(label) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

fn authorize_identity(identity: &WindowIdentity) -> AppResult<()> {
    if let Some(session) = identity.session_id() {
        project::ensure_project_session_mod_root(
            session,
            identity.mod_root().expect("session identity owns a root"),
        )?;
    }
    Ok(())
}

pub fn focus_managed_window(
    app: &AppHandle,
    caller: &str,
    identity: &WindowIdentity,
) -> AppResult<bool> {
    authorize_identity(identity)?;
    let label = registry()?.focus_target(caller, identity);
    if let Some(label) = label {
        focus_window(app, &label)?;
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn session_has_windows(session: &str) -> AppResult<bool> {
    Ok(registry()?
        .instances
        .values()
        .any(|instance| instance.identity.session_id() == Some(session)))
}

#[cfg(test)]
mod tests {
    use crate::services::project_sync::release_project_session;

    use super::*;
    #[cfg(test)]
    use crate::io::FsRootBoundary;
    #[cfg(test)]
    use crate::models::{EditWriteTarget, JointEditKind, ModSaveTarget, TextWindowLocation};
    use crate::models::{SpecEditorKind, WeaponFirePreviewSource};
    #[cfg(test)]
    use crate::services::project;
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::windows::WindowRegistry;
    #[cfg(test)]
    use crate::{io, models, test_support};
    use serde_json::Map;
    #[cfg(test)]
    use std::path::Path;
    #[cfg(test)]
    use std::{fs, slice};

    #[test]
    fn multi_document_editor_reservations_share_file_ownership_rules() {
        let mut state = WindowRegistry::default();
        let label = state.register(
            WindowIdentity::CodeEditor {
                session_id: "sample".into(),
                mod_root: "M:/sample".into(),
            },
            "code".into(),
            ManagedWindowInput::CodeEditor,
        );
        state.instances.get_mut(&label).unwrap().status.dirty = true;
        state.edit_targets.insert(
            label.clone(),
            vec![EditWriteTarget {
                session_id: "sample".into(),
                mod_root: "M:/sample".into(),
                path: "M:/sample/A.java".into(),
            }],
        );
        let identity = WindowIdentity::TextEditor {
            session_id: "sample".into(),
            mod_root: "M:/sample".into(),
            path: "M:/sample/a.java".into(),
        };
        assert_eq!(
            state.conflict("peer", slice::from_ref(&identity)),
            Some(label.clone())
        );
        assert_eq!(state.conflict(&label, slice::from_ref(&identity)), None);
        state.instances.get_mut(&label).unwrap().status.dirty = false;
        assert_eq!(state.conflict("peer", slice::from_ref(&identity)), None);
    }

    #[test]
    fn editor_bootstrap_delivers_the_owning_mod_name() {
        let root = project_workspace("window_mod_name");
        io::write_utf8_no_bom(
            &root.join("mod_info.json"),
            r#"{"id":"fixture","name":"Named Mod"}"#,
        )
        .unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("fixture"),
        )
        .unwrap();
        let identities = [
            (
                WindowIdentity::Immersive {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    kind: JointEditKind::Ship,
                    id: "fixture".into(),
                },
                ManagedWindowInput::ImmersiveEditor { row_key: None },
            ),
            (
                WindowIdentity::TextEditor {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    path: root.join("mod_info.json").to_string_lossy().into(),
                },
                ManagedWindowInput::TextEditor {
                    location: TextWindowLocation {
                        context_label: None,
                        context_severity: None,
                        message: None,
                        line: None,
                        column: None,
                    },
                },
            ),
        ];
        for (identity, input) in identities {
            let label = registry()
                .unwrap()
                .register(identity, "fixture".into(), input);
            let WindowBootstrap::Managed { mod_name, .. } =
                current_window_bootstrap(&label).unwrap()
            else {
                panic!("managed fixture")
            };
            assert_eq!(mod_name, "Named Mod");
            release_window(&label).unwrap();
        }
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn io_paths_share_focus_reservations_and_target_owners() {
        let root = project_workspace("window_expanded_identity");
        let path = root.join("Long filename.spec");
        fs::write(&path, "{}").unwrap();
        let identity = |root: &Path, path: &Path| {
            let boundary = FsRootBoundary::new(root, "window fixture").unwrap();
            WindowIdentity::TextEditor {
                session_id: "s".into(),
                mod_root: boundary.root().to_string_lossy().into(),
                path: boundary
                    .resolve_absolute(path, "file")
                    .unwrap()
                    .to_string_lossy()
                    .into(),
            }
        };
        let original = identity(&root, &path);
        let alias = identity(
            &test_support::short_path(&root),
            &test_support::short_path(&path),
        );
        assert_eq!(original, alias);
        let WindowIdentity::TextEditor {
            session_id,
            mod_root,
            path,
        } = &original
        else {
            unreachable!()
        };
        let target = EditWriteTarget {
            session_id: session_id.clone(),
            mod_root: mod_root.clone(),
            path: path.clone(),
        };
        let mut state = WindowRegistry::default();
        let label = register(&mut state, original);
        assert_eq!(state.focus_target("main", &alias), Some(label.clone()));
        state.instances.get_mut(&label).unwrap().status.dirty = true;
        assert_eq!(
            state.reserve("main", slice::from_ref(&alias)),
            Err(label.clone())
        );
        state
            .edit_targets
            .insert(label.clone(), vec![target.clone()]);
        assert_eq!(
            state.edit_target_owners(slice::from_ref(&target)),
            vec![label.clone()]
        );
        state.release(&label);
        assert!(state.edit_target_owners(&[target]).is_empty());
        root.close().unwrap();
    }

    #[test]
    fn edit_target_registration_respects_complete_scope_and_window_release() {
        let mut state = WindowRegistry::default();
        let target = EditWriteTarget {
            session_id: "s".into(),
            mod_root: "D:/Mod".into(),
            path: "D:/Mod/data/ships.csv".into(),
        };
        state
            .edit_targets
            .insert("main".into(), vec![target.clone()]);
        state.edit_targets.insert(
            "managed-1".into(),
            vec![EditWriteTarget {
                path: "d:\\MOD\\data".into(),
                ..target.clone()
            }],
        );
        assert_eq!(
            state.edit_target_owners(slice::from_ref(&target)),
            vec!["main", "managed-1"]
        );
        assert!(
            state
                .edit_target_owners(&[EditWriteTarget {
                    session_id: "other".into(),
                    ..target.clone()
                }])
                .is_empty()
        );
        state.release("managed-1");
        assert_eq!(state.edit_target_owners(&[target]), vec!["main"]);
    }
    fn register(state: &mut WindowRegistry, identity: WindowIdentity) -> String {
        let input = match &identity {
            WindowIdentity::Immersive { .. } => {
                ManagedWindowInput::ImmersiveEditor { row_key: None }
            }
            _ => ManagedWindowInput::Editor {
                starsector_root: None,
            },
        };
        state.register(identity, "test".into(), input)
    }
    fn identity(id: &str, root: &str, session: &str) -> WindowIdentity {
        WindowIdentity::Spec {
            session_id: session.into(),
            kind: SpecEditorKind::Weapon,
            mod_root: root.into(),
            id: id.into(),
        }
    }
    #[test]
    fn save_delivery_binds_owner_generation_and_release() {
        for released in ["main", "child"] {
            let mut state = WindowRegistry::default();
            let child = register(&mut state, identity("weapon", "M:/mod", "session"));
            let generation = state.register_save_receiver("main", Channel::new(|_| Ok(())));
            let request = WindowSaveRequest {
                target: ModSaveTarget {
                    session_id: "session".into(),
                    mod_root: "M:/mod".into(),
                },
                action: WindowSaveAction::Batch,
            };
            let mut invalid = request.clone();
            invalid.target.session_id = "other".into();
            assert!(state.receive_save(&child, "main", invalid).is_err());
            invalid = request.clone();
            invalid.action = WindowSaveAction::List;
            assert!(state.receive_save(&child, "main", invalid).is_err());
            let message = state.receive_save(&child, "main", request.clone()).unwrap();
            state.finish_save(
                &child,
                message.request_id,
                generation,
                Ok(WindowSaveReply::Results { items: vec![] }),
            );
            assert!(state.save_requests[&message.request_id].result.is_none());
            state.register_save_receiver("main", Channel::new(|_| Ok(())));
            assert!(
                state.save_requests[&message.request_id]
                    .result
                    .as_ref()
                    .unwrap()
                    .is_err()
            );
            let next = state.receive_save(&child, "main", request.clone()).unwrap();
            state.finish_save(
                "main",
                next.request_id,
                generation,
                Ok(WindowSaveReply::Results { items: vec![] }),
            );
            assert!(state.save_requests[&next.request_id].result.is_none());
            state.release(if released == "main" { "main" } else { &child });
            assert!(
                state.save_requests[&next.request_id]
                    .result
                    .as_ref()
                    .unwrap()
                    .is_err()
            );
        }
    }
    #[test]
    fn immersive_keeps_instance_scope() {
        let mut state = WindowRegistry::default();
        let target = WindowIdentity::Immersive {
            session_id: "s".into(),
            kind: JointEditKind::Ship,
            mod_root: "D:/Mod".into(),
            id: "Alpha".into(),
        };
        let label = register(&mut state, target.clone());
        assert_eq!(target.session_id(), Some("s"));
        assert_eq!(state.focus_target("main", &target), Some(label.clone()));
        assert_ne!(
            target.comparison_key(),
            identity("Alpha", "D:/Mod", "s").comparison_key()
        );
        let normalized = WindowIdentity::Immersive {
            session_id: "s".into(),
            kind: JointEditKind::Ship,
            mod_root: r"\\?\d:\mod\".into(),
            id: "Alpha".into(),
        };
        assert_eq!(state.focus_target("main", &normalized), Some(label.clone()));
        state.release(&label);
        assert_eq!(state.focus_target("main", &target), None);
    }
    #[test]
    fn focus_uses_complete_identity_and_retains_dirty_target_occupancy() {
        let mut state = WindowRegistry::default();
        let target = identity("Alpha", "D:/Mod", "s");
        let label = register(&mut state, target.clone());
        state.instances.get_mut(&label).unwrap().status.dirty = true;
        assert_eq!(
            state.focus_target("other", &identity("Alpha", r"\\?\d:\mod\", "s")),
            Some(label.clone())
        );
        assert_eq!(state.focus_target(&label, &target), None);
        assert_eq!(
            state.focus_target("other", &identity("Alpha", "D:/Mod", "new-session")),
            None
        );
        assert_eq!(
            state.focus_target("other", &identity("alpha", "D:/Mod", "s")),
            None
        );
        assert!(state.instances[&label].status.dirty);
        state.release(&label);
        assert_eq!(state.focus_target("other", &target), None);
    }
    #[test]
    fn comparison_keeps_entity_and_session_case_and_normalizes_paths() {
        assert_eq!(
            models::windows_path_key(r"\\?\UNC\Server\Share\Mod\"),
            "//server/share/mod"
        );
        assert_eq!(models::windows_path_key("D:/Mod//nested/"), "d:/mod/nested");
        assert_ne!(
            identity("Demo", "D:/Mod", "s").comparison_key(),
            identity("demo", "D:/Mod", "s").comparison_key()
        );
        assert_ne!(
            identity("Demo", "D:/Mod", "S").comparison_key(),
            identity("Demo", "D:/Mod", "s").comparison_key()
        );
        assert_eq!(
            identity("Demo", "D:/Mod/", "s").comparison_key(),
            identity("Demo", r"\\?\d:\mod", "s").comparison_key()
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_unicode_file_windows_keep_independent_owners() {
        let mut state = WindowRegistry::default();
        let first = WindowIdentity::TextEditor {
            session_id: "s".into(),
            mod_root: "D:/Mod".into(),
            path: "D:/Mod/İ.variant".into(),
        };
        let second = WindowIdentity::TextEditor {
            session_id: "s".into(),
            mod_root: "D:/Mod".into(),
            path: "D:/Mod/i\u{307}.variant".into(),
        };
        let first_label = register(&mut state, first.clone());
        let second_label = register(&mut state, second.clone());
        assert_ne!(first_label, second_label);
        assert_eq!(
            state.focus_target("main", &first),
            Some(first_label.clone())
        );
        assert_eq!(
            state.focus_target("main", &second),
            Some(second_label.clone())
        );
        state.release(&first_label);
        assert_eq!(state.focus_target("main", &second), Some(second_label));
    }
    #[test]
    fn reservation_and_retarget_keep_instance_and_release_occupancy() {
        let mut state = WindowRegistry::default();
        let old = register(&mut state, identity("old", "D:/Mod", "s"));
        state.instances.get_mut(&old).unwrap().creating = false;
        let occupied = register(&mut state, identity("next", "D:/Mod", "s"));
        state.instances.get_mut(&occupied).unwrap().creating = false;
        state.instances.get_mut(&occupied).unwrap().status.dirty = true;
        let next = identity("next", "D:/Mod", "s");
        assert_eq!(
            state.reserve(&old, slice::from_ref(&next)),
            Err(occupied.clone())
        );
        state.release(&occupied);
        state.reserve(&old, slice::from_ref(&next)).unwrap();
        state.retarget(&old, next.clone());
        assert_eq!(state.identities[&next.comparison_key()], old);
        state.release(&old);
        assert!(state.reservations.is_empty());
        assert!(state.identities.is_empty());
    }

    fn preview_input(value: &str) -> ManagedWindowInput {
        ManagedWindowInput::WeaponFirePreview {
            source: WeaponFirePreviewSource::Draft {
                weapon: Map::from_iter([
                    ("id".into(), serde_json::json!("w")),
                    ("description".into(), serde_json::json!(value)),
                ]),
            },
        }
    }
    fn preview_identity(id: &str) -> WindowIdentity {
        WindowIdentity::WeaponFirePreview {
            session_id: "s".into(),
            mod_root: "M:/mod".into(),
            id: id.into(),
        }
    }
    fn receipt(state: &WindowRegistry, id: u64) -> WindowRequestStatus {
        state.requests[&id]
            .result
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap()
            .status
    }
    #[test]
    fn latest_request_supersedes_pending_delivery_and_rejects_stale_receipts() {
        let mut state = WindowRegistry::default();
        let label = state.register(preview_identity("w"), "预览".into(), preview_input("first"));
        let first = state.receive(&label, "main", preview_input("first"));
        let second = state.receive(&label, "main", preview_input("second"));
        assert_eq!(receipt(&state, first), WindowRequestStatus::Superseded);
        assert!(!state.accept(&label, first, 0).unwrap());
        state.claim(&label).unwrap();
        assert!(state.accept(&label, second, 0).unwrap());
        assert_eq!(receipt(&state, second), WindowRequestStatus::Accepted);
        assert!(!state.accept(&label, second, 0).unwrap());
        assert_eq!(
            serde_json::to_value(state.context(&label, false).unwrap()).unwrap()["input"]["source"]
                ["weapon"]["description"],
            "second"
        );
    }
    #[test]
    fn reload_uses_accepted_source_while_pending_or_failed_input_stays_separate() {
        let mut state = WindowRegistry::default();
        let label = state.register(
            preview_identity("w"),
            "预览".into(),
            preview_input("accepted"),
        );
        let accepted = state.receive(&label, "main", preview_input("accepted"));
        state.claim(&label).unwrap();
        state.accept(&label, accepted, 0).unwrap();
        let failed = state.receive(&label, "main", preview_input("failed"));
        assert_eq!(state.context(&label, false).unwrap().request_id, accepted);
        assert_eq!(state.context(&label, true).unwrap().request_id, failed);
        let diagnostic = AppError::message("window.accept_failed", "交接失败").diagnostic();
        state.fail(&label, failed, diagnostic).unwrap();
        assert_eq!(state.context(&label, false).unwrap().request_id, accepted);
        assert_eq!(
            state.requests[&failed]
                .result
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap_err()
                .code,
            "window.accept_failed"
        );
        state.retarget(&label, preview_identity("renamed"));
        assert_eq!(
            serde_json::to_value(state.context(&label, false).unwrap()).unwrap()["input"]["source"]
                ["weapon"]["id"],
            "renamed"
        );
    }
    #[test]
    fn source_close_keeps_pending_input_deliverable_and_receiver_close_cancels_waiting() {
        let mut state = WindowRegistry::default();
        let label = state.register(preview_identity("w"), "预览".into(), preview_input("中文"));
        let id = state.receive(&label, "source", preview_input("中文"));
        state.release("source");
        assert!(state.requests[&id].owner.is_none());
        state.claim(&label).unwrap();
        assert!(state.accept(&label, id, 0).unwrap());
        assert!(!state.requests.contains_key(&id));
        assert_eq!(state.context(&label, false).unwrap().request_id, id);
        let waiting = state.receive(&label, "main", preview_input("pending"));
        state.release(&label);
        assert_eq!(receipt(&state, waiting), WindowRequestStatus::Cancelled);
        assert!(state.context(&label, false).is_err());
    }
    #[test]
    fn creation_failure_settles_current_request_and_preserves_diagnostic() {
        let mut state = WindowRegistry::default();
        let label = state.register(preview_identity("w"), "预览".into(), preview_input("draft"));
        let id = state.receive(&label, "main", preview_input("draft"));
        state
            .fail(
                &label,
                id,
                AppError::message("window.create_failed", "原生创建失败").diagnostic(),
            )
            .unwrap();
        state.release(&label);
        let error = state.requests[&id]
            .result
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap_err();
        assert_eq!(error.code, "window.create_failed");
        assert_eq!(error.message, "原生创建失败");
    }
    #[test]
    fn structured_window_payload_keeps_large_unicode_and_full_diagnostics() {
        let text = "中文🛰️".repeat(16000);
        let mut state = WindowRegistry::default();
        let label = state.register(preview_identity("w"), "预览".into(), preview_input(&text));
        let id = state.receive(&label, "main", preview_input(&text));
        state.claim(&label).unwrap();
        state.accept(&label, id, 0).unwrap();
        assert_eq!(
            serde_json::to_value(state.context(&label, false).unwrap()).unwrap()["input"]["source"]
                ["weapon"]["description"],
            text
        );
        let location = TextWindowLocation {
            context_label: Some("诊断".into()),
            context_severity: Some("error".into()),
            message: Some(text.clone()),
            line: Some(42),
            column: Some(13),
        };
        let input = ManagedWindowInput::TextEditor { location };
        let wire = serde_json::to_value(&input).unwrap();
        assert_eq!(wire["location"]["message"], text);
        assert_eq!(wire["location"]["line"], 42);
        let roundtrip: ManagedWindowInput = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(roundtrip).unwrap(), wire);
    }
    #[test]
    fn wing_input_requires_formal_csv_row_identity_at_transport_boundary() {
        let identity = WindowIdentity::Immersive {
            session_id: "s".into(),
            mod_root: "M:/mod".into(),
            kind: JointEditKind::Wing,
            id: "wing".into(),
        };
        assert!(!ManagedWindowInput::ImmersiveEditor { row_key: None }.matches(&identity));
        assert!(
            !ManagedWindowInput::ImmersiveEditor {
                row_key: Some(String::new())
            }
            .matches(&identity)
        );
        assert!(
            ManagedWindowInput::ImmersiveEditor {
                row_key: Some("wings:row:1".into())
            }
            .matches(&identity)
        );
    }

    #[test]
    fn wing_retarget_updates_accepted_and_pending_reload_inputs_together() {
        let mut state = WindowRegistry::default();
        let identity = WindowIdentity::Immersive {
            session_id: "s".into(),
            mod_root: "M:/mod".into(),
            kind: JointEditKind::Wing,
            id: "old".into(),
        };
        let input = ManagedWindowInput::ImmersiveEditor {
            row_key: Some("old-row".into()),
        };
        let label = state.register(identity, "战机联队".into(), input.clone());
        let accepted = state.receive(&label, "main", input.clone());
        state.claim(&label).unwrap();
        state.accept(&label, accepted, 0).unwrap();
        state.receive(&label, "main", input);
        let next = WindowIdentity::Immersive {
            session_id: "s".into(),
            mod_root: "M:/mod".into(),
            kind: JointEditKind::Wing,
            id: "next".into(),
        };
        state.retarget(&label, next);
        state.replace_input(
            &label,
            ManagedWindowInput::ImmersiveEditor {
                row_key: Some("next-row".into()),
            },
        );
        for pending in [false, true] {
            let context = serde_json::to_value(state.context(&label, pending).unwrap()).unwrap();
            assert_eq!(context["identity"]["id"], "next");
            assert_eq!(context["input"]["rowKey"], "next-row");
        }
    }
    #[test]
    fn active_delivery_finishes_before_latest_pending_and_reload_reclaims_it() {
        let mut state = WindowRegistry::default();
        let label = state.register(preview_identity("w"), "preview".into(), preview_input("a"));
        let a = state.receive(&label, "main", preview_input("a"));
        assert_eq!(state.claim(&label).unwrap().unwrap().request_id, a);
        let b = state.receive(&label, "main", preview_input("b"));
        let c = state.receive(&label, "main", preview_input("c"));
        assert_eq!(receipt(&state, b), WindowRequestStatus::Superseded);
        state.instances.get_mut(&label).unwrap().receiver_generation = 1;
        assert!(!state.accept(&label, a, 0).unwrap());
        assert_eq!(state.claim(&label).unwrap().unwrap().request_id, a);
        assert!(state.accept(&label, a, 1).unwrap());
        assert_eq!(receipt(&state, a), WindowRequestStatus::Accepted);
        assert_eq!(state.claim(&label).unwrap().unwrap().request_id, c);
        assert!(state.accept(&label, c, 1).unwrap());
        assert!(state.claim(&label).unwrap().is_none());
    }
}
