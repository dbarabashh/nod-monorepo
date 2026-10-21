use super::{reply, Reply};
use crate::error::Result;
use crate::materialize;
use crate::objects::resolve;
use crate::value::Scalar;
use automerge::{AutoCommit, ChangeHash, ObjId, ObjType, Prop, ReadDoc, Value, ROOT};
use serde_json::json;

fn entry(value: &Value<'_>, id: &ObjId, with_id: bool) -> serde_json::Value {
    match value {
        Value::Object(kind) => json!([kind.to_string(), id.to_string()]),
        Value::Scalar(scalar) => {
            let scalar = json!(Scalar::from(scalar.as_ref()));
            if with_id {
                json!([scalar, id.to_string()])
            } else {
                json!([scalar])
            }
        }
    }
}

pub fn keys(doc: &AutoCommit, obj: &str, heads: Option<Vec<ChangeHash>>) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    let keys: Vec<String> = match heads {
        Some(heads) => doc.keys_at(&obj, &heads).collect(),
        None => doc.keys(&obj).collect(),
    };
    reply(&keys)
}

pub fn length(doc: &AutoCommit, obj: &str, heads: Option<Vec<ChangeHash>>) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    reply(&match heads {
        Some(heads) => doc.length_at(&obj, &heads),
        None => doc.length(&obj),
    })
}

pub fn text(doc: &AutoCommit, obj: &str, heads: Option<Vec<ChangeHash>>) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    reply(&match heads {
        Some(heads) => doc.text_at(&obj, &heads)?,
        None => doc.text(&obj)?,
    })
}

pub fn get_with_type(
    doc: &AutoCommit,
    obj: &str,
    prop: Prop,
    heads: Option<Vec<ChangeHash>>,
) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    let found = match heads {
        Some(heads) => doc.get_at(&obj, prop, &heads)?,
        None => doc.get(&obj, prop)?,
    };
    reply(&found.map(|(value, id)| entry(&value, &id, false)))
}

pub fn get_all(
    doc: &AutoCommit,
    obj: &str,
    prop: Prop,
    heads: Option<Vec<ChangeHash>>,
) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    let values = match heads {
        Some(heads) => doc.get_all_at(&obj, prop, &heads)?,
        None => doc.get_all(&obj, prop)?,
    };
    reply(
        &values
            .iter()
            .map(|(value, id)| entry(value, id, true))
            .collect::<Vec<_>>(),
    )
}

/// An object id wasm can't resolve materializes the root, as wasm does.
pub fn materialize(
    doc: &mut AutoCommit,
    obj: &str,
    heads: Option<&[ChangeHash]>,
    update_cursor: bool,
) -> Result<Reply> {
    let (obj, kind) = resolve(doc, obj).unwrap_or((ROOT, ObjType::Map));
    let tree = reply(&materialize::materialize(doc, &obj, kind, heads)?)?;
    if update_cursor {
        doc.update_diff_cursor();
    }
    Ok(tree)
}
