use crate::value::{Bytes, Parsed, Tree};
use automerge::{ActorId, ChangeHash, Prop};
use serde::Deserialize;

pub type DocId = u32;
pub type Actor = Parsed<ActorId>;
pub type Heads = Vec<Parsed<ChangeHash>>;

pub fn heads(heads: Option<Heads>) -> Option<Vec<ChangeHash>> {
    heads.map(|heads| heads.into_iter().map(|h| h.0).collect())
}

/// A map key or a list index, as JS passes either.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Key {
    Map(String),
    Seq(usize),
}

impl From<Key> for Prop {
    fn from(key: Key) -> Self {
        match key {
            Key::Map(name) => Prop::Map(name),
            Key::Seq(index) => Prop::Seq(index),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LoadFlags {
    pub unchecked: bool,
    pub allow_missing_deps: bool,
    pub convert_immutable_strings_to_text: bool,
}

/// One call from the JS shim: an operation, on a document unless it makes one.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub doc: Option<DocId>,
    #[serde(flatten)]
    pub op: Op,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Info,
    Create {
        actor: Option<Actor>,
    },
    Load {
        bytes: Bytes,
        actor: Option<Actor>,
        #[serde(flatten)]
        flags: LoadFlags,
    },
    Free,
    Clone {
        actor: Option<Actor>,
    },
    Fork {
        actor: Option<Actor>,
        heads: Option<Heads>,
    },
    Merge {
        other: DocId,
    },
    GetChangesAdded {
        other: DocId,
    },

    Put {
        obj: String,
        prop: Key,
        value: Tree,
    },
    PutObject {
        obj: String,
        prop: Key,
        value: Tree,
    },
    PutObjectFromHydrate {
        obj: String,
        prop: Key,
        value: Tree,
    },
    Insert {
        obj: String,
        index: usize,
        value: Tree,
    },
    InsertObject {
        obj: String,
        index: usize,
        value: Tree,
    },
    InsertObjectFromHydrate {
        obj: String,
        index: usize,
        value: Tree,
    },
    Push {
        obj: String,
        value: Tree,
    },
    PushObject {
        obj: String,
        value: Tree,
    },
    SpliceFromHydrate {
        obj: String,
        index: usize,
        delete: isize,
        values: Vec<Tree>,
    },
    InitRootFromHydrate {
        value: Tree,
    },
    Splice {
        obj: String,
        start: usize,
        delete: isize,
        text: Option<String>,
        #[serde(default)]
        values: Vec<Tree>,
    },
    UpdateText {
        obj: String,
        text: String,
    },
    Delete {
        obj: String,
        prop: Key,
    },
    Increment {
        obj: String,
        prop: Key,
        value: f64,
    },
    Commit {
        message: Option<String>,
        time: Option<f64>,
    },
    EmptyChange {
        message: Option<String>,
        time: Option<f64>,
    },
    Rollback,

    Keys {
        obj: String,
        heads: Option<Heads>,
    },
    Length {
        obj: String,
        heads: Option<Heads>,
    },
    Text {
        obj: String,
        heads: Option<Heads>,
    },
    GetWithType {
        obj: String,
        prop: Key,
        heads: Option<Heads>,
    },
    GetAll {
        obj: String,
        prop: Key,
        heads: Option<Heads>,
    },
    Materialize {
        obj: String,
        heads: Option<Heads>,
        #[serde(default)]
        update_cursor: bool,
    },

    PendingOps,
    GetHeads,
    GetActorId,
    Save,
    SaveIncremental,
    SaveSince {
        heads: Option<Heads>,
    },
    LoadIncremental {
        bytes: Bytes,
    },
    ApplyChanges {
        changes: Vec<Bytes>,
    },
    GetChanges {
        heads: Option<Heads>,
    },
    GetMissingDeps {
        heads: Option<Heads>,
    },
    GetLastLocalChange,
    Isolate {
        heads: Heads,
    },
    Integrate,
    UpdateDiffCursor,
    ResetDiffCursor,
    DiffIncremental,
}
