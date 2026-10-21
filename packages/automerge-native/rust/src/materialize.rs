use crate::error::{Error, Result};
use crate::value::Scalar;
use automerge::iter::{DocItem, DocObjItem};
use automerge::{AutoCommit, ChangeHash, ObjId, ObjType, ReadDoc, ScalarValueRef, ValueRef};
use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use std::collections::HashMap;

// Each nesting level costs a native stack frame when the tree is assembled and
// serialized, and running out of stack aborts the app; wasm would trap
// instead. No document the apps write comes near this.
const MAX_DEPTH: usize = 256;

enum Slot<'a> {
    Scalar(ScalarValueRef<'a>),
    Child(ObjId),
}

enum Pending<'a> {
    Map(String, Vec<(String, Slot<'a>)>),
    List(String, ObjType, Vec<Slot<'a>>),
    Text(String),
}

/// A document object as the JS side rebuilds it, borrowing scalars from the
/// document until it is serialized.
pub enum Node<'a> {
    Map(String, Vec<(String, Node<'a>)>),
    List(String, ObjType, Vec<Node<'a>>),
    Text(String),
    Scalar(ScalarValueRef<'a>),
}

fn pending<'a>(id: &ObjId, kind: ObjType) -> Pending<'a> {
    match kind {
        ObjType::Map => Pending::Map(id.to_string(), Vec::new()),
        ObjType::Text => Pending::Text(String::new()),
        ObjType::List | ObjType::Table => Pending::List(id.to_string(), kind, Vec::new()),
    }
}

/// Port of automerge-wasm's `ExportCache::materialize`: one pass over the
/// document in iteration order, so the result matches what wasm builds.
pub fn materialize<'a>(
    doc: &'a AutoCommit,
    obj: &ObjId,
    kind: ObjType,
    heads: Option<&[ChangeHash]>,
) -> Result<Node<'a>> {
    if kind == ObjType::Text {
        let text = match heads {
            Some(heads) => doc.text_at(obj, heads)?,
            None => doc.text(obj)?,
        };
        return Ok(Node::Text(text));
    }
    if kind == ObjType::Table {
        return Err(Error::invalid("cannot materialize a table at the root"));
    }
    let mut objects = HashMap::from([(obj.clone(), pending(obj, kind))]);
    for DocObjItem { obj: owner, item } in doc.iter_at(obj, heads) {
        let (key, value, id) = match item {
            DocItem::Text(span) => {
                if let Some(Pending::Text(text)) = objects.get_mut(owner.as_ref()) {
                    text.push_str(span.as_str());
                }
                continue;
            }
            DocItem::Map(entry) => {
                let id = entry.id();
                (Some(entry.key.to_string()), entry.value, id)
            }
            DocItem::List(entry) => {
                let id = entry.id();
                (None, entry.value, id)
            }
        };
        let slot = match value {
            ValueRef::Object(child_kind) => {
                objects.insert(id.clone(), pending(&id, child_kind));
                Slot::Child(id)
            }
            ValueRef::Scalar(scalar) => Slot::Scalar(scalar),
        };
        match objects.get_mut(owner.as_ref()) {
            Some(Pending::Map(_, entries)) => entries.push((key.unwrap_or_default(), slot)),
            Some(Pending::List(_, _, items)) => items.push(slot),
            _ => {}
        }
    }
    assemble(obj, &mut objects, 0)
}

fn assemble<'a>(
    id: &ObjId,
    objects: &mut HashMap<ObjId, Pending<'a>>,
    depth: usize,
) -> Result<Node<'a>> {
    if depth > MAX_DEPTH {
        return Err(Error::invalid(format!(
            "the document nests deeper than {MAX_DEPTH} levels"
        )));
    }
    let pending = objects
        .remove(id)
        .ok_or_else(|| Error::invalid("an object is missing from the document"))?;
    let mut fill = |slot: Slot<'a>| -> Result<Node<'a>> {
        match slot {
            Slot::Scalar(value) => Ok(Node::Scalar(value)),
            Slot::Child(child) => assemble(&child, objects, depth + 1),
        }
    };
    Ok(match pending {
        Pending::Map(oid, entries) => Node::Map(
            oid,
            entries
                .into_iter()
                .map(|(key, slot)| Ok((key, fill(slot)?)))
                .collect::<Result<_>>()?,
        ),
        Pending::List(oid, kind, items) => Node::List(
            oid,
            kind,
            items.into_iter().map(fill).collect::<Result<_>>()?,
        ),
        Pending::Text(text) => Node::Text(text),
    })
}

impl Serialize for Node<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Node::Scalar(value) => Scalar::from(value).serialize(serializer),
            Node::Text(text) => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("t", "text")?;
                map.serialize_entry("v", text)?;
                map.end()
            }
            Node::Map(id, entries) => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("t", "map")?;
                map.serialize_entry("id", id)?;
                map.serialize_entry("v", entries)?;
                map.end()
            }
            Node::List(id, kind, items) => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("t", &kind.to_string())?;
                map.serialize_entry("id", id)?;
                map.serialize_entry("v", items)?;
                map.end()
            }
        }
    }
}
