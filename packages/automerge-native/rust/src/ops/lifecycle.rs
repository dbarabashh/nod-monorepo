use super::history::changes_reply;
use super::{reply, Reply};
use crate::error::Result;
use crate::protocol::{Actor, DocId, LoadFlags};
use crate::registry::Registry;
use crate::value::Bytes;
use automerge::{
    AutoCommit, ChangeHash, LoadOptions, OnPartialLoad, StringMigration, TextEncoding,
    VerificationMode,
};

fn with_actor(mut doc: AutoCommit, actor: Option<Actor>) -> AutoCommit {
    if let Some(actor) = actor {
        doc.set_actor(actor.0);
    }
    doc
}

/// The shape of automerge-wasm's `wasmReleaseInfo`, naming this crate instead.
pub fn info() -> Result<Reply> {
    reply(&serde_json::json!({
        "gitHead": "native",
        "cargoPackageName": env!("CARGO_PKG_NAME"),
        "cargoPackageVersion": env!("CARGO_PKG_VERSION"),
        "rustcVersion": env!("CARGO_PKG_RUST_VERSION"),
    }))
}

pub fn create(registry: &mut Registry, actor: Option<Actor>) -> Result<Reply> {
    let doc = AutoCommit::new_with_encoding(TextEncoding::Utf16CodeUnit);
    reply(&registry.add(with_actor(doc, actor))?)
}

pub fn load(
    registry: &mut Registry,
    bytes: &Bytes,
    actor: Option<Actor>,
    flags: &LoadFlags,
) -> Result<Reply> {
    let options = LoadOptions::new()
        .on_partial_load(if flags.allow_missing_deps {
            OnPartialLoad::Ignore
        } else {
            OnPartialLoad::Error
        })
        .verification_mode(if flags.unchecked {
            VerificationMode::DontCheck
        } else {
            VerificationMode::Check
        })
        .migrate_strings(if flags.convert_immutable_strings_to_text {
            StringMigration::ConvertToText
        } else {
            StringMigration::NoMigration
        })
        .text_encoding(TextEncoding::Utf16CodeUnit);
    let doc = AutoCommit::load_with_options(&bytes.0, options)?;
    reply(&registry.add(with_actor(doc, actor))?)
}

pub fn clone(registry: &mut Registry, doc: DocId, actor: Option<Actor>) -> Result<Reply> {
    let cloned = registry.get(doc)?.clone();
    reply(&registry.add(with_actor(cloned, actor))?)
}

pub fn fork(
    registry: &mut Registry,
    doc: DocId,
    actor: Option<Actor>,
    heads: Option<Vec<ChangeHash>>,
) -> Result<Reply> {
    let source = registry.get(doc)?;
    let forked = match heads {
        Some(heads) => source.fork_at(&heads)?,
        None => source.fork(),
    };
    reply(&registry.add(with_actor(forked, actor))?)
}

pub fn merge(registry: &mut Registry, doc: DocId, other: DocId) -> Result<Reply> {
    let heads = registry.with_pair(doc, other, |doc, other| Ok(doc.merge(other)?))?;
    super::history::heads_reply(&heads)
}

pub fn changes_added(registry: &mut Registry, doc: DocId, other: DocId) -> Result<Reply> {
    let changes = registry.with_pair(doc, other, |doc, other| Ok(doc.get_changes_added(other)))?;
    changes_reply(&changes)
}
