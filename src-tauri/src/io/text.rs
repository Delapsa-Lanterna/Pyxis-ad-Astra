use super::{read_versioned_bytes, validate_walk_entry};
use crate::errors::{AppError, AppResult};
use crate::parsers::game::text::decode_plain;
use std::fs::{self, OpenOptions};
use std::path::Path;

pub fn read_utf8_no_bom(path: &Path) -> AppResult<String> {
    let (_, bytes) = read_versioned_bytes(path)?;
    decode_text(path, &bytes)
}
pub(crate) fn decode_text(path: &Path, bytes: &[u8]) -> AppResult<String> {
    decode_plain(
        bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes),
        "utf-8",
    )
    .map_err(|error| AppError::from(error).at_path(path))
}
#[cfg(test)]
pub fn read_text_bytes_no_bom(path: &Path) -> AppResult<Vec<u8>> {
    let (_, bytes) = read_versioned_bytes(path)?;
    Ok(bytes
        .strip_prefix(&[0xef, 0xbb, 0xbf])
        .unwrap_or(&bytes)
        .to_vec())
}
pub fn write_utf8_no_bom(path: &Path, text: &str) -> AppResult<()> {
    if path.exists() {
        validate_walk_entry(path, "text output")?;
    }
    fs::write(path, text.as_bytes()).map_err(|error| AppError::from(error).at_path(path))
}
pub fn ensure_file_appendable(path: &Path) -> AppResult<()> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| AppError::from(error).at_path(path))
}

#[cfg(test)]
mod tests {
    use crate::test_support::TestWorkspace;

    use super::*;
    const UTF8_BOM: &[u8] = &[0xef, 0xbb, 0xbf];

    #[test]
    fn strips_utf8_bom() {
        let path = TestWorkspace::file("strips_utf8_bom.txt");
        fs::write(&path, [UTF8_BOM, "ok".as_bytes()].concat()).unwrap();
        let text = read_utf8_no_bom(&path).unwrap();
        assert_eq!(text, "ok");
        path.close().unwrap();
    }

    #[test]
    fn writes_utf8_without_bom() {
        let path = TestWorkspace::file("writes_utf8_without_bom.txt");
        write_utf8_no_bom(&path, "舰船").unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes.starts_with(UTF8_BOM));
        assert_eq!(String::from_utf8(bytes).unwrap(), "舰船");
        path.close().unwrap();
    }

    #[test]
    fn decoding_error_keeps_the_actual_file_for_transcoding() {
        let path = TestWorkspace::file("decoding_error_path.txt");
        fs::write(&path, [0x81]).unwrap();
        let error = read_utf8_no_bom(&path).unwrap_err();
        assert_eq!(error.code(), "text.invalid_utf8");
        assert_eq!(
            error.location().unwrap().path.as_deref(),
            Some(path.to_str().unwrap())
        );
        path.close().unwrap();
    }

    #[test]
    fn explicit_cp1252_keeps_smart_single_quotes() {
        let path = TestWorkspace::file("reads_cp1252_quote.txt");
        fs::write(&path, b"\x91it\x92s\x92").unwrap();

        assert!(read_utf8_no_bom(&path).is_err());
        let text = decode_plain(&fs::read(&path).unwrap(), "windows-1252").unwrap();
        assert_eq!(text, "‘it’s’");
        path.close().unwrap();
    }

    #[test]
    fn explicit_cp1252_keeps_smart_double_quotes() {
        let path = TestWorkspace::file("reads_cp1252_double_quotes.txt");
        fs::write(&path, b"\x93quoted\x94").unwrap();

        assert!(read_utf8_no_bom(&path).is_err());
        let text = decode_plain(&fs::read(&path).unwrap(), "windows-1252").unwrap();
        assert_eq!(text, "“quoted”");
        path.close().unwrap();
    }

    #[test]
    fn explicit_cp1252_keeps_en_dash() {
        let path = TestWorkspace::file("reads_cp1252_en_dash.txt");
        fs::write(&path, b"left \x96 right").unwrap();

        assert!(read_utf8_no_bom(&path).is_err());
        let text = decode_plain(&fs::read(&path).unwrap(), "windows-1252").unwrap();
        assert_eq!(text, "left – right");
        path.close().unwrap();
    }
}
