use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Number;
use serde_json::Value as JsonValue;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::error::Error as StdError;
use std::fmt::{Display, Formatter, Result as FmtResult};
use std::hash::{Hash, Hasher};
use std::iter::Copied;
use std::ops::Range;
use std::slice::Iter;
use std::str::EncodeUtf16;
use std::sync::Arc;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
    pub offset: usize,
    pub line: usize,
    pub column: usize,
}

impl Error {
    pub fn at(code: &'static str, message: impl Into<String>, source: &str, offset: usize) -> Self {
        let offset = offset.min(source.len());
        let prefix = &source[..offset];
        let line = prefix.bytes().filter(|b| *b == b'\n').count() + 1;
        let start = prefix.rfind('\n').map_or(0, |i| i + 1);
        let column = prefix[start..].encode_utf16().count() + 1;
        Self {
            code,
            message: message.into(),
            offset,
            line,
            column,
        }
    }

    pub fn output(message: impl Into<String>) -> Self {
        Self::at("write.format", message, "", 0)
    }
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(
            f,
            "{} at {}:{}: {}",
            self.code, self.line, self.column, self.message
        )
    }
}

impl StdError for Error {}

#[derive(Clone, Debug)]
pub enum Text {
    Utf8(String),
    Source(Arc<str>, Range<usize>),
    Utf16(Vec<u16>),
}

enum Units<'a> {
    Utf8(EncodeUtf16<'a>),
    Utf16(Copied<Iter<'a, u16>>),
}

impl Iterator for Units<'_> {
    type Item = u16;
    fn next(&mut self) -> Option<u16> {
        match self {
            Self::Utf8(v) => v.next(),
            Self::Utf16(v) => v.next(),
        }
    }
}

impl Text {
    pub fn new(value: impl Into<String>) -> Self {
        Self::Utf8(value.into())
    }
    pub fn from_units(value: Vec<u16>) -> Self {
        match String::from_utf16(&value) {
            Ok(s) => Self::Utf8(s),
            Err(_) => Self::Utf16(value),
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Utf8(s) => Some(s),
            Self::Source(s, range) => Some(&s[range.clone()]),
            Self::Utf16(_) => None,
        }
    }
    fn iter(&self) -> Units<'_> {
        match self {
            Self::Utf16(v) => Units::Utf16(v.iter().copied()),
            _ => Units::Utf8(self.as_str().expect("UTF-8 text").encode_utf16()),
        }
    }
    pub fn units(&self) -> Vec<u16> {
        self.iter().collect()
    }
    pub fn equals(&self, s: &str) -> bool {
        self.iter().eq(s.encode_utf16())
    }
    pub fn to_utf8(&self) -> Result<String, Error> {
        self.as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::output("UTF-16 text needs an exact caller representation"))
    }
    pub fn java_hash(&self) -> u32 {
        self.iter()
            .fold(0u32, |h, n| h.wrapping_mul(31).wrapping_add(n as u32))
    }
}
impl From<&str> for Text {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl Serialize for Text {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.as_str() {
            Some(text) => serializer.serialize_str(text),
            None => self.units().serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Representation {
            Utf8(String),
            Units(Vec<u16>),
        }
        Ok(match Representation::deserialize(deserializer)? {
            Representation::Utf8(text) => Self::new(text),
            Representation::Units(units) => Self::from_units(units),
        })
    }
}

mod integer_wire {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    pub fn serialize<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

mod float_wire {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    pub fn serialize<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:016x}", value.to_bits()))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
        u64::from_str_radix(&String::deserialize(deserializer)?, 16)
            .map(f64::from_bits)
            .map_err(D::Error::custom)
    }
}

impl PartialEq for Text {
    fn eq(&self, b: &Self) -> bool {
        match (self.as_str(), b.as_str()) {
            (Some(a), Some(b)) => a == b,
            _ => self.iter().eq(b.iter()),
        }
    }
}
impl Eq for Text {}
impl Hash for Text {
    fn hash<H: Hasher>(&self, h: &mut H) {
        for u in self.iter() {
            u.hash(h);
        }
    }
}
impl PartialOrd for Text {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for Text {
    fn cmp(&self, b: &Self) -> Ordering {
        self.iter().cmp(b.iter())
    }
}

// Numeric payloads bypass JavaScript number so the wire preserves the file value.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Value {
    Null,
    Bool(bool),
    Integer(#[serde(with = "integer_wire")] i64),
    Float(#[serde(with = "float_wire")] f64),
    Text(Text),
    Array(Vec<Value>),
    Object(Vec<(Text, Value)>),
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Null, Self::Null) => true,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Integer(a), Self::Integer(b)) => a == b,
            (Self::Float(a), Self::Float(b)) => a == b,
            (Self::Text(a), Self::Text(b)) => a == b,
            (Self::Array(a), Self::Array(b)) => a == b,
            (Self::Object(a), Self::Object(b)) => {
                if a.len() != b.len() {
                    return false;
                }
                if a.iter().zip(b).all(|((k, _), (q, _))| k == q) {
                    return a.iter().zip(b).all(|((_, v), (_, w))| v == w);
                }
                let lookup = b.iter().map(|(k, v)| (k, v)).collect::<HashMap<_, _>>();
                a.iter().all(|(k, v)| lookup.get(k) == Some(&v))
            }
            _ => false,
        }
    }
}

impl Value {
    pub fn same_content_order(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Object(a), Self::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|((k, v), (q, w))| k == q && v.same_content_order(w))
            }
            (Self::Array(a), Self::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.same_content_order(b))
            }
            _ => self == other,
        }
    }
    pub fn get(&self, key: &str) -> Option<&Self> {
        match self {
            Self::Object(v) => v.iter().find(|(k, _)| k.equals(key)).map(|(_, v)| v),
            _ => None,
        }
    }
    #[cfg(test)]
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Self> {
        match self {
            Self::Object(v) => v.iter_mut().find(|(k, _)| k.equals(key)).map(|(_, v)| v),
            _ => None,
        }
    }
    #[cfg(test)]
    pub fn set(&mut self, key: &str, value: Value) {
        if let Some(v) = self.get_mut(key) {
            *v = value;
        } else if let Self::Object(v) = self {
            v.push((Text::new(key), value));
        }
    }
    pub fn to_json(&self) -> Result<JsonValue, Error> {
        Ok(match self {
            Self::Null => JsonValue::Null,
            Self::Bool(b) => (*b).into(),
            Self::Integer(i) => (*i).into(),
            Self::Float(f) => Number::from_f64(*f)
                .ok_or_else(|| {
                    Error::output("non-finite value needs an exact caller representation")
                })?
                .into(),
            Self::Text(t) => t.to_utf8()?.into(),
            Self::Array(v) => {
                JsonValue::Array(v.iter().map(Self::to_json).collect::<Result<_, _>>()?)
            }
            Self::Object(v) => JsonValue::Object(
                v.iter()
                    .map(|(k, v)| Ok((k.to_utf8()?, v.to_json()?)))
                    .collect::<Result<_, Error>>()?,
            ),
        })
    }
}
