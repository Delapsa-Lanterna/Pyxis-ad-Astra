use crate::models::file_value::{Text, Value};
use crate::parsers::game::java_float;
use crate::parsers::game::java_map;

pub fn digit(ch: char, radix: u32) -> Option<u32> {
    let n = ch as u32;
    let d = match ch {
        '0'..='9' => n - 0x30,
        'a'..='z' => n - 0x61 + 10,
        'A'..='Z' => n - 0x41 + 10,
        '\u{ff21}'..='\u{ff3a}' => n - 0xff21 + 10,
        '\u{ff41}'..='\u{ff5a}' => n - 0xff41 + 10,
        _ => {
            // Java 17 Character.digit(char, radix), restricted to UTF-16 code units.
            const ZERO: &[u32] = &[
                0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
                0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
                0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0,
                0xaa50, 0xabf0, 0xff10,
            ];
            let start = ZERO.iter().find(|s| n >= **s && n < **s + 10)?;
            n - start
        }
    };
    (d < radix).then_some(d)
}

pub fn integer(word: &str, radix: u32, min: i64, max: i64) -> Option<i64> {
    let (negative, text) = if let Some(s) = word.strip_prefix('-') {
        (true, s)
    } else {
        (false, word.strip_prefix('+').unwrap_or(word))
    };
    if text.is_empty() {
        return None;
    }
    let limit = if negative {
        -(min as i128)
    } else {
        max as i128
    };
    let mut n = 0i128;
    for ch in text.chars() {
        n = n
            .checked_mul(radix as i128)?
            .checked_add(digit(ch, radix)? as i128)?;
        if n > limit {
            return None;
        }
    }
    Some(if negative { -n as i64 } else { n as i64 })
}

fn boolean(word: &str, target: &str) -> bool {
    word.chars()
        .map(|c| {
            if c == '\u{17f}' {
                's'
            } else {
                c.to_ascii_lowercase()
            }
        })
        .eq(target.chars())
}

pub fn word_value(word: &str) -> Option<Value> {
    if boolean(word, "true") {
        return Some(Value::Bool(true));
    }
    if boolean(word, "false") {
        return Some(Value::Bool(false));
    }
    if boolean(word, "null") {
        return Some(Value::Null);
    }
    if !word.starts_with(|c: char| c.is_ascii_digit() || matches!(c, '.' | '-' | '+')) {
        return None;
    }
    if let Some(hex) = word.strip_prefix("0x").or_else(|| word.strip_prefix("0X"))
        && let Some(n) = integer(hex, 16, i32::MIN as i64, i32::MAX as i64)
    {
        return Some(Value::Integer(n));
    }
    if word.contains(['.', 'e', 'E']) {
        let raw = word.strip_suffix(['f', 'F', 'd', 'D']).unwrap_or(word);
        let unsigned = raw.trim_start_matches(['+', '-']);
        let n = if unsigned.starts_with("0x") || unsigned.starts_with("0X") {
            hex_float(raw)
        } else {
            raw.parse::<f64>().ok()
        };
        if let Some(n) = n {
            return Some(Value::Float(n));
        }
    } else if let Some(n) = integer(word, 10, i64::MIN, i64::MAX) {
        return Some(Value::Integer(n));
    }
    None
}

pub fn hex_float(raw: &str) -> Option<f64> {
    let negative = raw.starts_with('-');
    let raw = raw.trim_start_matches(['+', '-']);
    let raw = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X"))?;
    let (fraction, power) = raw.split_once(['p', 'P'])?;
    if power.is_empty() {
        return None;
    }
    let negative_power = power.starts_with('-');
    let exponent_digits = power.strip_prefix(['+', '-']).unwrap_or(power);
    if exponent_digits.is_empty() || !exponent_digits.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let magnitude = exponent_digits.bytes().fold(0i64, |n, c| {
        n.saturating_mul(10)
            .saturating_add((c - b'0') as i64)
            .min(1_000_000_000)
    });
    let exponent = if negative_power {
        -magnitude
    } else {
        magnitude
    };
    let mut before = 0i64;
    let mut dot = false;
    let mut digits = Vec::with_capacity(fraction.len());
    for b in fraction.bytes() {
        if b == b'.' {
            if dot {
                return None;
            }
            dot = true;
        } else {
            let n = (b as char).to_digit(16)? as u8;
            digits.push(n);
            if !dot {
                before += 1;
            }
        }
    }
    if digits.is_empty() {
        return None;
    }
    let Some(first) = digits.iter().position(|n| *n != 0) else {
        return Some(f64::from_bits((negative as u64) << 63));
    };
    let high = 7 - digits[first].leading_zeros() as i64;
    let mut e = (before - first as i64 - 1) * 4 + high + exponent;
    if e > 1023 {
        return Some(if negative {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    if e < -1075 {
        return Some(f64::from_bits((negative as u64) << 63));
    }
    let precision = if e >= -1022 {
        53usize
    } else {
        (e + 1075) as usize
    };
    let mut significant = 0u64;
    let mut seen = 0usize;
    let mut round = false;
    let mut sticky = false;
    for (i, d) in digits.iter().enumerate().skip(first) {
        let top = if i == first { high as usize } else { 3 };
        for bit in (0..=top).rev() {
            let b = (d >> bit) & 1 != 0;
            if seen < precision {
                significant = (significant << 1) | b as u64;
            } else if seen == precision {
                round = b;
            } else {
                sticky |= b;
            }
            seen += 1;
        }
    }
    if seen < precision {
        significant <<= precision - seen;
    }
    if round && (sticky || significant & 1 != 0) {
        significant += 1;
    }
    let bits = if e >= -1022 {
        if significant == 1 << 53 {
            significant >>= 1;
            e += 1;
        }
        if e > 1023 {
            return Some(if negative {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            });
        }
        (((e + 1023) as u64) << 52) | (significant & ((1 << 52) - 1))
    } else {
        significant
    };
    Some(f64::from_bits(bits | ((negative as u64) << 63)))
}

pub fn java_double(n: f64) -> String {
    java_float::format(n)
}

fn ascii(text: &str, out: &mut Vec<u16>) {
    out.extend(text.encode_utf16());
}
fn quote_java(text: &Text, out: &mut Vec<u16>) {
    out.push(34);
    let mut previous = 0;
    for n in text.units() {
        match n {
            34 => ascii("\\\"", out),
            92 => ascii("\\\\", out),
            47 if previous == 60 => ascii("\\/", out),
            8 => ascii("\\b", out),
            9 => ascii("\\t", out),
            10 => ascii("\\n", out),
            12 => ascii("\\f", out),
            13 => ascii("\\r", out),
            n if n < 32 || (0x80..0xa0).contains(&n) || (0x2000..0x2100).contains(&n) => {
                ascii(&format!("\\u{n:04x}"), out)
            }
            n => out.push(n),
        }
        previous = n;
    }
    out.push(34);
}

fn json_number(n: f64) -> String {
    let mut s = java_double(n);
    if s.contains('.') && !s.contains('E') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    s
}

fn nested(value: &Value, out: &mut Vec<u16>) -> bool {
    if matches!(value,Value::Float(n) if !n.is_finite()) {
        return false;
    }
    let start = out.len();
    if !compound(value, out) {
        out.truncate(start);
        ascii("null", out);
    }
    true
}
fn compound(value: &Value, out: &mut Vec<u16>) -> bool {
    match value {
        Value::Text(t) => quote_java(t, out),
        Value::Null => ascii("null", out),
        Value::Bool(b) => ascii(if *b { "true" } else { "false" }, out),
        Value::Integer(n) => ascii(&n.to_string(), out),
        Value::Float(n) => ascii(&json_number(*n), out),
        Value::Array(v) => {
            out.push(91);
            for (i, x) in v.iter().enumerate() {
                if i > 0 {
                    out.push(44);
                }
                if !nested(x, out) {
                    return false;
                }
            }
            out.push(93);
        }
        Value::Object(v) => {
            out.push(123);
            for (i, index) in java_map::order(v).into_iter().enumerate() {
                let (key, value) = &v[index];
                if i > 0 {
                    out.push(44);
                }
                quote_java(key, out);
                out.push(58);
                if !nested(value, out) {
                    return false;
                }
            }
            out.push(125);
        }
    }
    true
}

pub fn key(value: Value) -> Option<Text> {
    match value {
        Value::Text(t) => Some(t),
        Value::Float(n) => Some(Text::new(java_double(n))),
        other => {
            let mut out = Vec::new();
            compound(&other, &mut out).then(|| Text::from_units(out))
        }
    }
}
