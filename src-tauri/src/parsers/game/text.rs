use crate::models::file_value::Error;
use encoding_rs::Encoding;
use std::borrow::Cow;
use std::str;

pub fn decode_plain(bytes: &[u8], encoding: &str) -> Result<String, Error> {
    if encoding.eq_ignore_ascii_case("utf-8") {
        return str::from_utf8(bytes).map(str::to_owned).map_err(|e| {
            let prefix = str::from_utf8(&bytes[..e.valid_up_to()]).expect("validated UTF-8 prefix");
            Error::at(
                "text.invalid_utf8",
                format!("invalid UTF-8 byte {}", e.valid_up_to()),
                prefix,
                prefix.len(),
            )
        });
    }
    let encoding = Encoding::for_label(encoding.as_bytes())
        .ok_or_else(|| Error::output("unknown source encoding"))?;
    let (text, failed) = encoding.decode_without_bom_handling(bytes);
    if failed {
        return Err(Error::output(
            "source encoding cannot decode the complete input",
        ));
    }
    Ok(text.into_owned())
}

pub fn decode_game(bytes: &[u8]) -> Cow<'_, str> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if let Ok(text) = str::from_utf8(bytes) {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(bytes.len());
    let mut remaining = bytes;
    while !remaining.is_empty() {
        match str::from_utf8(remaining) {
            Ok(s) => {
                out.push_str(s);
                break;
            }
            Err(e) => {
                out.push_str(
                    str::from_utf8(&remaining[..e.valid_up_to()]).expect("validated prefix"),
                );
                remaining = &remaining[e.valid_up_to()..];
                // Java consumes a surrogate prefix, including a truncated two-byte prefix.
                let n = if remaining.len() >= 2
                    && remaining[0] == 0xed
                    && (0xa0..=0xbf).contains(&remaining[1])
                {
                    if remaining.get(2).is_some_and(|b| (0x80..=0xbf).contains(b)) {
                        3
                    } else {
                        2
                    }
                } else {
                    e.error_len().unwrap_or(remaining.len())
                };
                out.push('\u{fffd}');
                remaining = &remaining[n..];
            }
        }
    }
    Cow::Owned(out)
}
