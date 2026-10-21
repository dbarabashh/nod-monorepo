use crate::error::{Error, Result};
use crate::value::Tree;
use automerge::transaction::Transactable;
use automerge::{AutoCommit, ObjId, ObjType, Prop, ReadDoc, ScalarValue, Value, ROOT};

/// Resolves an object id the way automerge-wasm does: `_root`, `1@aabb`, either
/// followed by `/prop/prop`, or a bare `/prop/prop` path from the root.
pub fn resolve(doc: &AutoCommit, id: &str) -> Result<(ObjId, ObjType)> {
    let mut components = id.split('/');
    let first = components.next().unwrap_or_default();
    let (mut obj, mut kind) = if first.is_empty() {
        (ROOT, ObjType::Map)
    } else {
        doc.import(first)?
    };
    for (i, prop) in components.take_while(|prop| !prop.is_empty()).enumerate() {
        let prop = if matches!(kind, ObjType::Map | ObjType::Table) {
            Prop::Map(prop.to_string())
        } else {
            Prop::Seq(prop.parse().map_err(|_| {
                Error::invalid(format!("path component {i} ({prop}) is not an index"))
            })?)
        };
        match doc.get(&obj, prop)? {
            Some((Value::Object(child_kind), child)) => {
                kind = child_kind;
                obj = child;
            }
            Some(_) => return Err(Error::invalid("path does not point to an object")),
            None => return Err(Error::invalid(format!("no object at path component {i}"))),
        }
    }
    Ok((obj, kind))
}

/// Where a write lands: replacing a map value or list element, or inserting
/// a new list element before an index.
pub enum Slot {
    Put(Prop),
    Insert(usize),
}

/// Writes a scalar into its slot.
pub fn write_scalar(
    doc: &mut AutoCommit,
    obj: &ObjId,
    slot: Slot,
    value: ScalarValue,
) -> Result<()> {
    match slot {
        Slot::Put(prop) => doc.put(obj, prop, value)?,
        Slot::Insert(index) => doc.insert(obj, index, value)?,
    }
    Ok(())
}

fn kind_of(tree: &Tree) -> Option<ObjType> {
    match tree {
        Tree::Map(_) => Some(ObjType::Map),
        Tree::List(_) => Some(ObjType::List),
        Tree::Text(_) => Some(ObjType::Text),
        _ => None,
    }
}

/// Port of automerge-wasm's `putObject`/`insertObject` and its `subset`: makes
/// the object in its slot and writes its contents in order.
pub fn create_object(doc: &mut AutoCommit, obj: &ObjId, slot: Slot, tree: Tree) -> Result<ObjId> {
    let kind = kind_of(&tree).ok_or_else(|| Error::invalid("expected an object"))?;
    let child = match slot {
        Slot::Put(prop) => doc.put_object(obj, prop, kind)?,
        Slot::Insert(index) => doc.insert_object(obj, index, kind)?,
    };
    match tree {
        Tree::Text(text) => doc.splice_text(&child, 0, 0, &text)?,
        Tree::Map(entries) => {
            for (key, value) in entries {
                write(doc, &child, Slot::Put(Prop::Map(key)), value)?;
            }
        }
        Tree::List(items) => {
            for (index, value) in items.into_iter().enumerate() {
                write(doc, &child, Slot::Insert(index), value)?;
            }
        }
        _ => unreachable!("kind_of accepted only objects"),
    }
    Ok(child)
}

fn write(doc: &mut AutoCommit, obj: &ObjId, slot: Slot, value: Tree) -> Result<()> {
    if kind_of(&value).is_some() {
        create_object(doc, obj, slot, value)?;
        return Ok(());
    }
    write_scalar(doc, obj, slot, value.into_scalar()?)
}

/// Port of automerge-wasm's `splice`: text into a text object is a text splice;
/// into a list it inserts one string per character.
pub fn splice(
    doc: &mut AutoCommit,
    obj: &ObjId,
    kind: ObjType,
    start: usize,
    delete: isize,
    text: Option<String>,
    values: Vec<Tree>,
) -> Result<()> {
    let scalars = match text {
        Some(text) if kind == ObjType::Text => {
            doc.splice_text(obj, start, delete, &text)?;
            return Ok(());
        }
        Some(text) => text
            .chars()
            .map(|c| ScalarValue::Str(c.to_string().into()))
            .collect(),
        None => values
            .into_iter()
            .map(Tree::into_scalar)
            .collect::<Result<Vec<_>>>()?,
    };
    if scalars.is_empty() && kind == ObjType::Text {
        doc.splice_text(obj, start, delete, "")?;
    } else if !scalars.is_empty() || kind == ObjType::List {
        doc.splice(obj, start, delete, scalars)?;
    }
    Ok(())
}
