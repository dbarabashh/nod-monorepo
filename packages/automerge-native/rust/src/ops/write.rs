use super::{reply, Reply};
use crate::error::{Error, Result};
use crate::objects::{self, resolve, Slot};
use crate::value::Tree;
use automerge::hydrate::Value as Hydrate;
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{AutoCommit, ObjType, Prop, ReadDoc};

pub fn put(doc: &mut AutoCommit, obj: &str, slot: Slot, value: Tree) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    objects::write_scalar(doc, &obj, slot, value.into_scalar()?)?;
    reply(&())
}

pub fn push(doc: &mut AutoCommit, obj: &str, value: Tree) -> Result<Reply> {
    let (id, _) = resolve(doc, obj)?;
    let end = doc.length(&id);
    put(doc, obj, Slot::Insert(end), value)
}

pub fn create_object(doc: &mut AutoCommit, obj: &str, slot: Slot, value: Tree) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    reply(&objects::create_object(doc, &obj, slot, value)?.to_string())
}

pub fn push_object(doc: &mut AutoCommit, obj: &str, value: Tree) -> Result<Reply> {
    let (id, _) = resolve(doc, obj)?;
    let end = doc.length(&id);
    create_object(doc, obj, Slot::Insert(end), value)
}

pub fn hydrate(
    doc: &mut AutoCommit,
    obj: &str,
    prop: Prop,
    insert: bool,
    value: Tree,
) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    let created = doc.batch_create_object(&obj, prop, &value.into_hydrate()?, insert)?;
    reply(&created.to_string())
}

pub fn splice_hydrate(
    doc: &mut AutoCommit,
    obj: &str,
    index: usize,
    delete: isize,
    values: Vec<Tree>,
) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    let values = values
        .into_iter()
        .map(Tree::into_hydrate)
        .collect::<Result<Vec<_>>>()?;
    doc.splice(&obj, index, delete, values)?;
    reply(&())
}

pub fn init_root(doc: &mut AutoCommit, value: Tree) -> Result<Reply> {
    let Hydrate::Map(map) = value.into_hydrate()? else {
        return Err(Error::invalid("the root must be a map"));
    };
    doc.init_root_from_hydrate(&map)?;
    reply(&())
}

pub fn splice(
    doc: &mut AutoCommit,
    obj: &str,
    start: usize,
    delete: isize,
    text: Option<String>,
    values: Vec<Tree>,
) -> Result<Reply> {
    let (obj, kind) = resolve(doc, obj)?;
    objects::splice(doc, &obj, kind, start, delete, text, values)?;
    reply(&())
}

pub fn update_text(doc: &mut AutoCommit, obj: &str, text: &str) -> Result<Reply> {
    let (obj, kind) = resolve(doc, obj)?;
    if kind != ObjType::Text {
        return Err(Error::invalid("updateText needs a text object"));
    }
    doc.update_text(&obj, text)?;
    reply(&())
}

pub fn delete(doc: &mut AutoCommit, obj: &str, prop: Prop) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    doc.delete(&obj, prop)?;
    reply(&())
}

pub fn increment(doc: &mut AutoCommit, obj: &str, prop: Prop, by: f64) -> Result<Reply> {
    let (obj, _) = resolve(doc, obj)?;
    doc.increment(&obj, prop, by as i64)?;
    reply(&())
}

fn commit_options(message: Option<String>, time: Option<f64>) -> CommitOptions {
    CommitOptions {
        message,
        time: time.map(|t| t as i64),
    }
}

pub fn commit(doc: &mut AutoCommit, message: Option<String>, time: Option<f64>) -> Result<Reply> {
    let hash = doc.commit_with(commit_options(message, time));
    reply(&hash.map(|h| h.to_string()))
}

pub fn empty_change(
    doc: &mut AutoCommit,
    message: Option<String>,
    time: Option<f64>,
) -> Result<Reply> {
    reply(&doc.empty_change(commit_options(message, time)).to_string())
}
