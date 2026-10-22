use crate::{
    errors::{AppError, AppResult},
    models::{
        ManagedWindowContext, ManagedWindowInput, ManagedWindowRequest, ManagedWindowStatus,
        WindowBootstrap, WindowIdentity, WindowRequestReceipt, WindowRequestStatus,
    },
};
use std::{
    collections::BTreeMap,
    sync::{Condvar, LazyLock, Mutex},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
pub mod auxiliary {
    use crate::errors::{AppError, AppResult};
    use std::io;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    };

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
                io::Error::last_os_error().into(),
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
                io::Error::last_os_error().into(),
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
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
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
                    ..std::mem::zeroed()
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
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
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
    request_sequence: u64,
    requests: BTreeMap<u64, PendingWindowRequest>,
    edit_targets: BTreeMap<String, Vec<crate::models::EditWriteTarget>>,
    sequence: u64,
    identities: BTreeMap<WindowIdentity, String>,
    instances: BTreeMap<String, WindowInstance>,
    reservations: BTreeMap<WindowIdentity, String>,
    closing: BTreeMap<u64, (String, crate::models::CloseScope, Vec<String>)>,
}

struct PendingWindowRequest {
    owner: Option<String>,
    label: String,
    result: Option<Result<WindowRequestReceipt, crate::errors::ErrorDiagnostic>>,
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
    fn edit_target_owners(&self, targets: &[crate::models::EditWriteTarget]) -> Vec<String> {
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
    fn fail(
        &mut self,
        label: &str,
        id: u64,
        diagnostic: crate::errors::ErrorDiagnostic,
    ) -> AppResult<()> {
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
fn registry() -> AppResult<std::sync::MutexGuard<'static, WindowRegistry>> {
    REGISTRY
        .0
        .lock()
        .map_err(|_| AppError::message("window.registry_poisoned", "窗口登记状态不可用"))
}

pub(crate) fn register_window_request(
    app: &tauri::AppHandle,
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
        matches!(&request.identity, WindowIdentity::Immersive { .. }).then_some(tauri::Theme::Dark);
    let key = request.identity.comparison_key();
    let (opened, create, notify) = {
        let mut state = registry()?;
        if state
            .closing
            .values()
            .any(|(_, scope, labels)| match scope {
                crate::models::CloseScope::Application => true,
                crate::models::CloseScope::Sessions { session_ids } => request
                    .identity
                    .session_id()
                    .is_some_and(|id| session_ids.iter().any(|session| session == id)),
                crate::models::CloseScope::Window => state
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
    let built = WebviewWindowBuilder::new(app, &opened.label, WebviewUrl::App("/".into()))
        .title(request.title)
        .visible(false)
        .decorations(false)
        .theme(native_theme)
        .inner_size(request.width, request.height)
        .min_inner_size(request.min_width, request.min_height)
        .build();
    let mut state = registry()?;
    match built {
        Ok(_window) => {
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
        return Ok(WindowBootstrap::Main);
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
        Some(session) => super::project::current_projection(session)?
            .manifest
            .mod_info
            .and_then(|info| {
                info.get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            }),
        None => None,
    }
    .unwrap_or_else(|| {
        context
            .identity
            .mod_root()
            .and_then(|root| std::path::Path::new(root).file_name())
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "未关联 Mod".into())
    });
    Ok(WindowBootstrap::Managed {
        context: Box::new(context),
        restoring,
        mod_name,
    })
}
pub fn current_window_context(label: &str) -> AppResult<ManagedWindowContext> {
    registry()?.context(label, false)
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
    diagnostic: crate::errors::ErrorDiagnostic,
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
pub fn fail_window_startup(
    label: &str,
    diagnostic: crate::errors::ErrorDiagnostic,
) -> AppResult<()> {
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
pub fn await_window_request(
    owner: &str,
    id: u64,
) -> Result<WindowRequestReceipt, crate::errors::ErrorDiagnostic> {
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

pub fn update_status(label: &str, status: ManagedWindowStatus) -> AppResult<()> {
    if let Some(instance) = registry()?.instances.get_mut(label) {
        instance.status = status;
    }
    REGISTRY.1.notify_all();
    Ok(())
}

pub fn update_edit_targets(
    label: &str,
    targets: Vec<crate::models::EditWriteTarget>,
) -> AppResult<()> {
    for target in &targets {
        super::project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
        crate::io::FsRootBoundary::new(std::path::Path::new(&target.mod_root), "edit target root")?
            .resolve_absolute(std::path::Path::new(&target.path), "edit target")?;
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

pub fn query_edit_target_owners(
    targets: &[crate::models::EditWriteTarget],
) -> AppResult<Vec<String>> {
    for target in targets {
        super::project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
    }
    let state = registry()?;
    Ok(state.edit_target_owners(targets))
}

fn edit_targets_overlap(
    left: &crate::models::EditWriteTarget,
    right: &crate::models::EditWriteTarget,
) -> bool {
    if left.session_id != right.session_id
        || crate::models::windows_path_key(&left.mod_root)
            != crate::models::windows_path_key(&right.mod_root)
    {
        return false;
    }
    let left = crate::models::windows_path_key(&left.path);
    let right = crate::models::windows_path_key(&right.path);
    left == right
        || left.starts_with(&format!("{right}/"))
        || right.starts_with(&format!("{left}/"))
}

pub fn reserve_edit_targets(
    app: &tauri::AppHandle,
    label: &str,
    targets: &[crate::models::EditWriteTarget],
) -> AppResult<()> {
    for target in targets {
        super::project::ensure_project_session_mod_root(&target.session_id, &target.mod_root)?;
    }
    let identities = targets
        .iter()
        .map(|target| WindowIdentity::File {
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

pub fn focus_edit_target_owner(app: &tauri::AppHandle, label: &str) -> AppResult<bool> {
    if !registry()?.edit_targets.contains_key(label) {
        return Ok(false);
    }
    focus_window(app, label)?;
    Ok(true)
}

pub fn reserve_targets(
    app: &tauri::AppHandle,
    label: &str,
    identities: Vec<WindowIdentity>,
) -> AppResult<Vec<String>> {
    let displaced = {
        let mut state = registry()?;
        if let Err(conflict) = state.reserve(label, &identities) {
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
    scope: &crate::models::CloseScope,
    parent: Option<u64>,
) -> AppResult<Vec<String>> {
    let mut state = registry()?;
    let mut labels: Vec<_> = state
        .instances
        .iter()
        .filter(|(label, instance)| match scope {
            crate::models::CloseScope::Window => label.as_str() == owner,
            crate::models::CloseScope::Sessions { session_ids } => instance
                .identity
                .session_id()
                .is_some_and(|id| session_ids.iter().any(|session| session == id)),
            crate::models::CloseScope::Application => true,
        })
        .map(|(label, _)| label.clone())
        .collect();
    if *scope != crate::models::CloseScope::Window {
        labels.insert(0, "main".into());
    }
    if state.closing.iter().any(|(id, (_, other, occupied))| {
        Some(*id) != parent
            && (scope.overlaps(other) || labels.iter().any(|label| occupied.contains(label)))
    }) {
        return Err(AppError::message("lifecycle.busy", "所属范围正在关闭"));
    }
    state
        .closing
        .insert(id, (owner.into(), scope.clone(), labels.clone()));
    Ok(labels)
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
    app: &tauri::AppHandle,
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
        if let Some(conflict) = state.conflict(label, std::slice::from_ref(&identity)) {
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

fn focus_window(app: &tauri::AppHandle, label: &str) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(label) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

fn authorize_identity(identity: &WindowIdentity) -> AppResult<()> {
    if let Some(session) = identity.session_id() {
        super::project::ensure_project_session_mod_root(
            session,
            identity.mod_root().expect("session identity owns a root"),
        )?;
    }
    Ok(())
}

pub fn focus_managed_window(
    app: &tauri::AppHandle,
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
    use super::*;

    #[test]
    fn editor_bootstrap_delivers_the_owning_mod_name() {
        let root = crate::testutil::temp_dir("window_mod_name");
        crate::io::write_utf8_no_bom(
            &root.join("mod_info.json"),
            r#"{"id":"fixture","name":"Named Mod"}"#,
        )
        .unwrap();
        let manifest = super::super::project::open_project_session_traced(
            &root,
            None,
            &mut super::super::project::PerformanceTrace::new("fixture"),
        )
        .unwrap();
        let identities = [
            (
                WindowIdentity::Immersive {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    kind: crate::models::JointEditKind::Ship,
                    id: "fixture".into(),
                },
                ManagedWindowInput::ImmersiveEditor { row_key: None },
            ),
            (
                WindowIdentity::File {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    path: root.join("mod_info.json").to_string_lossy().into(),
                },
                ManagedWindowInput::FileEditor {
                    location: crate::models::FileWindowLocation {
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
        super::super::project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn io_paths_share_focus_reservations_and_target_owners() {
        let root = crate::testutil::temp_dir("window_expanded_identity");
        let path = root.join("Long filename.spec");
        std::fs::write(&path, "{}").unwrap();
        let identity = |root: &std::path::Path, path: &std::path::Path| {
            let boundary = crate::io::FsRootBoundary::new(root, "window fixture").unwrap();
            WindowIdentity::File {
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
            &crate::testutil::short_path(&root),
            &crate::testutil::short_path(&path),
        );
        assert_eq!(original, alias);
        let WindowIdentity::File {
            session_id,
            mod_root,
            path,
        } = &original
        else {
            unreachable!()
        };
        let target = crate::models::EditWriteTarget {
            session_id: session_id.clone(),
            mod_root: mod_root.clone(),
            path: path.clone(),
        };
        let mut state = WindowRegistry::default();
        let label = register(&mut state, original);
        assert_eq!(state.focus_target("main", &alias), Some(label.clone()));
        state.instances.get_mut(&label).unwrap().status.dirty = true;
        assert_eq!(
            state.reserve("main", std::slice::from_ref(&alias)),
            Err(label.clone())
        );
        state
            .edit_targets
            .insert(label.clone(), vec![target.clone()]);
        assert_eq!(
            state.edit_target_owners(std::slice::from_ref(&target)),
            vec![label.clone()]
        );
        state.release(&label);
        assert!(state.edit_target_owners(&[target]).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn edit_target_registration_respects_complete_scope_and_window_release() {
        let mut state = super::WindowRegistry::default();
        let target = crate::models::EditWriteTarget {
            session_id: "s".into(),
            mod_root: "D:/Mod".into(),
            path: "D:/Mod/data/ships.csv".into(),
        };
        state
            .edit_targets
            .insert("main".into(), vec![target.clone()]);
        state.edit_targets.insert(
            "managed-1".into(),
            vec![crate::models::EditWriteTarget {
                path: "d:\\MOD\\data".into(),
                ..target.clone()
            }],
        );
        assert_eq!(
            state.edit_target_owners(std::slice::from_ref(&target)),
            vec!["main", "managed-1"]
        );
        assert!(
            state
                .edit_target_owners(&[crate::models::EditWriteTarget {
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
            kind: crate::models::SpecEditorKind::Weapon,
            mod_root: root.into(),
            id: id.into(),
        }
    }
    #[test]
    fn immersive_keeps_instance_scope() {
        let mut state = WindowRegistry::default();
        let target = WindowIdentity::Immersive {
            session_id: "s".into(),
            kind: crate::models::JointEditKind::Ship,
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
            kind: crate::models::JointEditKind::Ship,
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
            crate::models::windows_path_key(r"\\?\UNC\Server\Share\Mod\"),
            "//server/share/mod"
        );
        assert_eq!(
            crate::models::windows_path_key("D:/Mod//nested/"),
            "d:/mod/nested"
        );
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
    fn reservation_and_retarget_keep_instance_and_release_occupancy() {
        let mut state = WindowRegistry::default();
        let old = register(&mut state, identity("old", "D:/Mod", "s"));
        state.instances.get_mut(&old).unwrap().creating = false;
        let occupied = register(&mut state, identity("next", "D:/Mod", "s"));
        state.instances.get_mut(&occupied).unwrap().creating = false;
        state.instances.get_mut(&occupied).unwrap().status.dirty = true;
        let next = identity("next", "D:/Mod", "s");
        assert_eq!(
            state.reserve(&old, std::slice::from_ref(&next)),
            Err(occupied.clone())
        );
        state.release(&occupied);
        state.reserve(&old, std::slice::from_ref(&next)).unwrap();
        state.retarget(&old, next.clone());
        assert_eq!(state.identities[&next.comparison_key()], old);
        state.release(&old);
        assert!(state.reservations.is_empty());
        assert!(state.identities.is_empty());
    }

    fn preview_input(value: &str) -> ManagedWindowInput {
        ManagedWindowInput::WeaponFirePreview {
            source: crate::models::WeaponFirePreviewSource::Draft {
                weapon: serde_json::Map::from_iter([
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
        let location = crate::models::FileWindowLocation {
            context_label: Some("诊断".into()),
            context_severity: Some("error".into()),
            message: Some(text.clone()),
            line: Some(42),
            column: Some(13),
        };
        let input = ManagedWindowInput::FileEditor { location };
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
            kind: crate::models::JointEditKind::Wing,
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
            kind: crate::models::JointEditKind::Wing,
            id: "old".into(),
        };
        let input = ManagedWindowInput::ImmersiveEditor {
            row_key: Some("old-row".into()),
        };
        let label = state.register(identity.clone(), "战机联队".into(), input.clone());
        let accepted = state.receive(&label, "main", input.clone());
        state.claim(&label).unwrap();
        state.accept(&label, accepted, 0).unwrap();
        state.receive(&label, "main", input);
        let next = WindowIdentity::Immersive {
            session_id: "s".into(),
            mod_root: "M:/mod".into(),
            kind: crate::models::JointEditKind::Wing,
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
