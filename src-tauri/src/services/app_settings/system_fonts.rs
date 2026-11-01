use crate::errors::{AppError, AppResult};
#[cfg(windows)]
use std::collections::BTreeSet;
#[cfg(windows)]
use std::io::Error;
#[cfg(windows)]
use std::ptr;
use windows_sys::Win32;
use windows_sys::Win32::Graphics::Gdi::LOGFONTW;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{DEFAULT_CHARSET, EnumFontFamiliesExW, GetDC, ReleaseDC};

/// Returns distinct installed horizontal font families in name order.
/// Failure to acquire the Windows screen device context preserves the OS error.
#[cfg(windows)]
pub fn query_system_fonts() -> AppResult<Vec<String>> {
    let mut families = BTreeSet::<String>::new();
    let filter = LOGFONTW {
        lfCharSet: DEFAULT_CHARSET,
        ..Default::default()
    };
    // GDI calls the callback synchronously; the collection outlives enumeration.
    unsafe {
        let dc = GetDC(ptr::null_mut());
        if dc.is_null() {
            return Err(AppError::context(
                "Enumerating installed font families",
                Error::last_os_error().into(),
            ));
        }
        EnumFontFamiliesExW(
            dc,
            &filter,
            Some(collect_family),
            &mut families as *mut BTreeSet<String> as isize,
            0,
        );
        ReleaseDC(ptr::null_mut(), dc);
    }
    Ok(families.into_iter().collect())
}

#[cfg(windows)]
unsafe extern "system" fn collect_family(
    font: *const LOGFONTW,
    _metrics: *const Win32::Graphics::Gdi::TEXTMETRICW,
    _kind: u32,
    data: isize,
) -> i32 {
    // GDI supplies a valid LOGFONTW and our live collection for each callback.
    let face = unsafe { &(*font).lfFaceName };
    let length = face
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(face.len());
    let name = String::from_utf16_lossy(&face[..length]);
    // An @ prefix denotes the vertical alias of a horizontal font family.
    if !name.starts_with('@') {
        unsafe { &mut *(data as *mut BTreeSet<String>) }.insert(name);
    }
    1
}

#[cfg(not(windows))]
pub fn query_system_fonts() -> AppResult<Vec<String>> {
    Err(AppError::message(
        "fonts.platform_unsupported",
        "Installed font enumeration requires Windows",
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn installed_family_contract() {
        let families = query_system_fonts().unwrap();
        assert!(!families.is_empty());
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(families.iter().all(|name| !name.starts_with('@')));
        assert!(families.iter().any(|name| name == "Segoe UI"));
    }
}
