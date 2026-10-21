use super::{reply, Reply};
use crate::error::Result;
use crate::value::{base64, Bytes};
use automerge::{AutoCommit, Change, ChangeHash};

pub fn heads_reply(heads: &[ChangeHash]) -> Result<Reply> {
    reply(&heads.iter().map(ToString::to_string).collect::<Vec<_>>())
}

pub fn bytes_reply(bytes: &[u8]) -> Result<Reply> {
    reply(&base64(bytes))
}

pub fn changes_reply(changes: &[Change]) -> Result<Reply> {
    reply(
        &changes
            .iter()
            .map(|change| base64(change.raw_bytes()))
            .collect::<Vec<_>>(),
    )
}

pub fn apply_changes(doc: &mut AutoCommit, changes: &[Bytes]) -> Result<Reply> {
    let changes = changes
        .iter()
        .map(|bytes| Change::try_from(bytes.0.as_slice()))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    doc.apply_changes(changes)?;
    reply(&())
}

pub fn last_local_change(doc: &mut AutoCommit) -> Result<Reply> {
    reply(
        &doc.get_last_local_change()
            .map(|change| base64(change.raw_bytes())),
    )
}
