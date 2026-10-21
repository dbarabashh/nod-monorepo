mod history;
mod lifecycle;
mod read;
mod write;

use crate::error::{Error, Result};
use crate::objects::Slot;
use crate::protocol::{heads, DocId, Op, Request};
use crate::registry::Registry;
use serde::Serialize;

/// The JSON text of one reply value.
pub type Reply = String;

pub fn reply<T: Serialize + ?Sized>(value: &T) -> Result<Reply> {
    Ok(serde_json::to_string(value)?)
}

fn handle(doc: Option<DocId>) -> Result<DocId> {
    doc.ok_or_else(|| Error::invalid("missing document handle"))
}

pub fn dispatch(registry: &mut Registry, Request { doc, op }: Request) -> Result<Reply> {
    match op {
        Op::Info => lifecycle::info(),
        Op::Create { actor } => lifecycle::create(registry, actor),
        Op::Load {
            bytes,
            actor,
            flags,
        } => lifecycle::load(registry, &bytes, actor, &flags),
        Op::Free => {
            registry.remove(handle(doc)?);
            reply(&())
        }
        Op::Clone { actor } => lifecycle::clone(registry, handle(doc)?, actor),
        Op::Fork { actor, heads: at } => lifecycle::fork(registry, handle(doc)?, actor, heads(at)),
        Op::Merge { other } => lifecycle::merge(registry, handle(doc)?, other),
        Op::GetChangesAdded { other } => lifecycle::changes_added(registry, handle(doc)?, other),
        op => document_op(registry.get(handle(doc)?)?, op),
    }
}

fn document_op(doc: &mut automerge::AutoCommit, op: Op) -> Result<Reply> {
    use automerge::transaction::Transactable;
    use automerge::{Prop, ReadDoc};
    match op {
        Op::Put { obj, prop, value } => write::put(doc, &obj, Slot::Put(prop.into()), value),
        Op::Insert { obj, index, value } => write::put(doc, &obj, Slot::Insert(index), value),
        Op::Push { obj, value } => write::push(doc, &obj, value),
        Op::PutObject { obj, prop, value } => {
            write::create_object(doc, &obj, Slot::Put(prop.into()), value)
        }
        Op::InsertObject { obj, index, value } => {
            write::create_object(doc, &obj, Slot::Insert(index), value)
        }
        Op::PushObject { obj, value } => write::push_object(doc, &obj, value),
        Op::PutObjectFromHydrate { obj, prop, value } => {
            write::hydrate(doc, &obj, prop.into(), false, value)
        }
        Op::InsertObjectFromHydrate { obj, index, value } => {
            write::hydrate(doc, &obj, Prop::Seq(index), true, value)
        }
        Op::SpliceFromHydrate {
            obj,
            index,
            delete,
            values,
        } => write::splice_hydrate(doc, &obj, index, delete, values),
        Op::InitRootFromHydrate { value } => write::init_root(doc, value),
        Op::Splice {
            obj,
            start,
            delete,
            text,
            values,
        } => write::splice(doc, &obj, start, delete, text, values),
        Op::UpdateText { obj, text } => write::update_text(doc, &obj, &text),
        Op::Delete { obj, prop } => write::delete(doc, &obj, prop.into()),
        Op::Increment { obj, prop, value } => write::increment(doc, &obj, prop.into(), value),
        Op::Commit { message, time } => write::commit(doc, message, time),
        Op::EmptyChange { message, time } => write::empty_change(doc, message, time),
        Op::Rollback => reply(&doc.rollback()),

        Op::Keys { obj, heads: at } => read::keys(doc, &obj, heads(at)),
        Op::Length { obj, heads: at } => read::length(doc, &obj, heads(at)),
        Op::Text { obj, heads: at } => read::text(doc, &obj, heads(at)),
        Op::GetWithType {
            obj,
            prop,
            heads: at,
        } => read::get_with_type(doc, &obj, prop.into(), heads(at)),
        Op::GetAll {
            obj,
            prop,
            heads: at,
        } => read::get_all(doc, &obj, prop.into(), heads(at)),
        Op::Materialize {
            obj,
            heads: at,
            update_cursor,
        } => read::materialize(doc, &obj, heads(at).as_deref(), update_cursor),

        Op::PendingOps => reply(&doc.pending_ops()),
        Op::GetHeads => history::heads_reply(&doc.get_heads()),
        Op::GetActorId => reply(&doc.get_actor().to_hex_string()),
        Op::Save => history::bytes_reply(&doc.save()),
        Op::SaveIncremental => history::bytes_reply(&doc.save_incremental()),
        Op::SaveSince { heads: at } => {
            history::bytes_reply(&doc.save_after(&heads(at).unwrap_or_default()))
        }
        Op::LoadIncremental { bytes } => reply(&doc.load_incremental(&bytes.0)?),
        Op::ApplyChanges { changes } => history::apply_changes(doc, &changes),
        Op::GetChanges { heads: at } => {
            history::changes_reply(&doc.get_changes(&heads(at).unwrap_or_default()))
        }
        Op::GetMissingDeps { heads: at } => {
            // The inherent method closes the open transaction; wasm's read doesn't.
            let missing = ReadDoc::get_missing_deps(&*doc, &heads(at).unwrap_or_default());
            history::heads_reply(&missing)
        }
        Op::GetLastLocalChange => history::last_local_change(doc),
        Op::Isolate { heads: at } => {
            doc.isolate(&heads(Some(at)).unwrap_or_default());
            reply(&())
        }
        Op::Integrate => {
            doc.integrate();
            reply(&())
        }
        Op::UpdateDiffCursor => {
            doc.update_diff_cursor();
            reply(&())
        }
        Op::ResetDiffCursor => {
            doc.reset_diff_cursor();
            reply(&())
        }
        Op::DiffIncremental => Ok(crate::patches::to_json(&doc.diff_incremental())?),

        Op::Info
        | Op::Create { .. }
        | Op::Load { .. }
        | Op::Free
        | Op::Clone { .. }
        | Op::Fork { .. }
        | Op::Merge { .. }
        | Op::GetChangesAdded { .. } => unreachable!("dispatched before this"),
    }
}
