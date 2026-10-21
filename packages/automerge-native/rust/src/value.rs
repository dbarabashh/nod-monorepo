use crate::error::{Error, Result};
use automerge::{ScalarValue, ScalarValueRef, TextEncoding};
use base64::Engine;
use serde::de::{self, Deserializer};
use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

const BASE64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// A value sent as text and parsed on arrival: actor ids and hashes as hex,
/// and numbers as decimals, because a JSON number is a double on the JS side
/// and 64-bit integers, -0 and infinities would not survive it.
#[derive(Debug)]
pub struct Parsed<T>(pub T);

impl<'de, T: FromStr> Deserialize<'de> for Parsed<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        text.parse()
            .map(Parsed)
            .map_err(|_| de::Error::custom(format!("{text:?} could not be parsed")))
    }
}

/// Bytes sent as base64.
#[derive(Debug)]
pub struct Bytes(pub Vec<u8>);

impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        BASE64.decode(text).map(Bytes).map_err(de::Error::custom)
    }
}

pub fn base64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// A JS value as the shim sends it: an object with its contents, or a scalar.
#[derive(Debug, Deserialize)]
#[serde(tag = "t", content = "v", rename_all = "lowercase")]
pub enum Tree {
    Map(Vec<(String, Tree)>),
    List(Vec<Tree>),
    Text(String),
    Str(String),
    Int(Parsed<i64>),
    Uint(Parsed<u64>),
    F64(Parsed<f64>),
    Counter(Parsed<i64>),
    Timestamp(Parsed<i64>),
    Boolean(bool),
    Null,
    Bytes(Bytes),
}

impl Tree {
    pub fn into_scalar(self) -> Result<ScalarValue> {
        Ok(match self {
            Tree::Str(s) => ScalarValue::Str(s.into()),
            Tree::Int(n) => ScalarValue::Int(n.0),
            Tree::Uint(n) => ScalarValue::Uint(n.0),
            Tree::F64(n) => ScalarValue::F64(n.0),
            Tree::Counter(n) => ScalarValue::counter(n.0),
            Tree::Timestamp(n) => ScalarValue::Timestamp(n.0),
            Tree::Boolean(b) => ScalarValue::Boolean(b),
            Tree::Null => ScalarValue::Null,
            Tree::Bytes(b) => ScalarValue::Bytes(b.0),
            Tree::Map(_) | Tree::List(_) | Tree::Text(_) => {
                return Err(Error::invalid("expected a scalar value"))
            }
        })
    }

    pub fn into_hydrate(self) -> Result<automerge::hydrate::Value> {
        use automerge::hydrate::{Text, Value};
        Ok(match self {
            Tree::Map(entries) => Value::Map(
                entries
                    .into_iter()
                    .map(|(key, value)| Ok((key, value.into_hydrate()?)))
                    .collect::<Result<HashMap<_, _>>>()?
                    .into(),
            ),
            Tree::List(items) => Value::List(
                items
                    .into_iter()
                    .map(Tree::into_hydrate)
                    .collect::<Result<Vec<_>>>()?
                    .into(),
            ),
            Tree::Text(text) => Value::Text(Text::new(TextEncoding::Utf16CodeUnit, text)),
            scalar => Value::Scalar(scalar.into_scalar()?),
        })
    }
}

/// A scalar borrowed from a document or a patch, written as `{"t", "v"}`.
pub enum Scalar<'a> {
    Bytes(&'a [u8]),
    Str(&'a str),
    Int(i64),
    Uint(u64),
    F64(f64),
    Counter(i64),
    Timestamp(i64),
    Boolean(bool),
    Null,
    Unknown { code: u8, bytes: &'a [u8] },
}

impl<'a> From<&'a ScalarValue> for Scalar<'a> {
    fn from(value: &'a ScalarValue) -> Self {
        match value {
            ScalarValue::Bytes(b) => Scalar::Bytes(b),
            ScalarValue::Str(s) => Scalar::Str(s),
            ScalarValue::Int(i) => Scalar::Int(*i),
            ScalarValue::Uint(u) => Scalar::Uint(*u),
            ScalarValue::F64(f) => Scalar::F64(*f),
            ScalarValue::Counter(c) => Scalar::Counter(i64::from(c)),
            ScalarValue::Timestamp(t) => Scalar::Timestamp(*t),
            ScalarValue::Boolean(b) => Scalar::Boolean(*b),
            ScalarValue::Null => Scalar::Null,
            ScalarValue::Unknown { type_code, bytes } => Scalar::Unknown {
                code: *type_code,
                bytes,
            },
        }
    }
}

impl<'a> From<&'a ScalarValueRef<'a>> for Scalar<'a> {
    fn from(value: &'a ScalarValueRef<'a>) -> Self {
        match value {
            ScalarValueRef::Bytes(b) => Scalar::Bytes(b),
            ScalarValueRef::Str(s) => Scalar::Str(s),
            ScalarValueRef::Int(i) => Scalar::Int(*i),
            ScalarValueRef::Uint(u) => Scalar::Uint(*u),
            ScalarValueRef::F64(f) => Scalar::F64(*f),
            ScalarValueRef::Counter(c) => Scalar::Counter(*c),
            ScalarValueRef::Timestamp(t) => Scalar::Timestamp(*t),
            ScalarValueRef::Boolean(b) => Scalar::Boolean(*b),
            ScalarValueRef::Null => Scalar::Null,
            ScalarValueRef::Unknown { type_code, bytes } => Scalar::Unknown {
                code: *type_code,
                bytes,
            },
        }
    }
}

impl Serialize for Scalar<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(2))?;
        match self {
            Scalar::Bytes(b) => tagged(&mut map, "bytes", &base64(b))?,
            Scalar::Str(s) => tagged(&mut map, "str", s)?,
            Scalar::Int(i) => tagged(&mut map, "int", &i.to_string())?,
            Scalar::Uint(u) => tagged(&mut map, "uint", &u.to_string())?,
            Scalar::F64(f) => tagged(&mut map, "f64", &f.to_string())?,
            Scalar::Counter(c) => tagged(&mut map, "counter", &c.to_string())?,
            Scalar::Timestamp(t) => tagged(&mut map, "timestamp", &t.to_string())?,
            Scalar::Boolean(b) => tagged(&mut map, "boolean", b)?,
            Scalar::Null => map.serialize_entry("t", "null")?,
            Scalar::Unknown { code, bytes } => tagged(
                &mut map,
                "unknown",
                &serde_json::json!({ "code": code, "bytes": base64(bytes) }),
            )?,
        }
        map.end()
    }
}

fn tagged<M: SerializeMap, V: Serialize + ?Sized>(
    map: &mut M,
    tag: &str,
    value: &V,
) -> std::result::Result<(), M::Error> {
    map.serialize_entry("t", tag)?;
    map.serialize_entry("v", value)
}
