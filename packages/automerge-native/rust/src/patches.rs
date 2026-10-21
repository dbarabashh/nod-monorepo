use crate::value::Scalar;
use automerge::{ObjId, Patch, PatchAction, Prop, Value};
use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;

#[derive(Serialize)]
#[serde(untagged)]
enum Step<'a> {
    Key(&'a str),
    Index(usize),
}

impl<'a> From<&'a Prop> for Step<'a> {
    fn from(prop: &'a Prop) -> Self {
        match prop {
            Prop::Map(key) => Step::Key(key),
            Prop::Seq(index) => Step::Index(*index),
        }
    }
}

/// A patch value: objects as their type only (the JS side makes an empty one),
/// scalars as typed values.
struct PatchValue<'a>(&'a Value<'a>);

impl Serialize for PatchValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Object(kind) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("t", &kind.to_string())?;
                map.end()
            }
            Value::Scalar(scalar) => Scalar::from(scalar.as_ref()).serialize(serializer),
        }
    }
}

#[derive(Serialize)]
struct MarkOut<'a> {
    name: &'a str,
    value: Scalar<'a>,
    start: usize,
    end: usize,
}

/// Port of automerge-wasm's `export_patch`, with values left typed for the JS side.
#[derive(Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum PatchOut<'a> {
    Put {
        path: Vec<Step<'a>>,
        value: PatchValue<'a>,
        conflict: bool,
    },
    Insert {
        path: Vec<Step<'a>>,
        values: Vec<PatchValue<'a>>,
        conflicts: Vec<bool>,
    },
    Splice {
        path: Vec<Step<'a>>,
        value: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        marks: Vec<(&'a str, Scalar<'a>)>,
    },
    Inc {
        path: Vec<Step<'a>>,
        value: f64,
    },
    Del {
        path: Vec<Step<'a>>,
        length: usize,
    },
    Mark {
        path: Vec<Step<'a>>,
        marks: Vec<MarkOut<'a>>,
    },
    Conflict {
        path: Vec<Step<'a>>,
    },
}

fn path<'a>(path: &'a [(ObjId, Prop)], end: Option<Step<'a>>) -> Vec<Step<'a>> {
    path.iter()
        .map(|(_, prop)| Step::from(prop))
        .chain(end)
        .collect()
}

fn export(patch: &Patch) -> PatchOut<'_> {
    let at = patch.path.as_slice();
    match &patch.action {
        PatchAction::PutMap {
            key,
            value,
            conflict,
            ..
        } => PatchOut::Put {
            path: path(at, Some(Step::Key(key))),
            value: PatchValue(&value.0),
            conflict: *conflict,
        },
        PatchAction::PutSeq {
            index,
            value,
            conflict,
            ..
        } => PatchOut::Put {
            path: path(at, Some(Step::Index(*index))),
            value: PatchValue(&value.0),
            conflict: *conflict,
        },
        PatchAction::Insert { index, values, .. } => PatchOut::Insert {
            path: path(at, Some(Step::Index(*index))),
            values: values.iter().map(|v| PatchValue(&v.0)).collect(),
            conflicts: values.iter().map(|v| v.2).collect(),
        },
        PatchAction::SpliceText {
            index,
            value,
            marks,
            ..
        } => PatchOut::Splice {
            path: path(at, Some(Step::Index(*index))),
            value: value.make_string(),
            marks: marks
                .iter()
                .flat_map(|marks| marks.iter())
                .map(|(name, value)| (name, Scalar::from(value)))
                .collect(),
        },
        PatchAction::Increment { prop, value, .. } => PatchOut::Inc {
            path: path(at, Some(Step::from(prop))),
            value: *value as f64,
        },
        PatchAction::DeleteMap { key, .. } => PatchOut::Del {
            path: path(at, Some(Step::Key(key))),
            length: 1,
        },
        PatchAction::DeleteSeq { index, length, .. } => PatchOut::Del {
            path: path(at, Some(Step::Index(*index))),
            length: *length,
        },
        PatchAction::Mark { marks, .. } => PatchOut::Mark {
            path: path(at, None),
            marks: marks
                .iter()
                .map(|mark| MarkOut {
                    name: mark.name(),
                    value: Scalar::from(mark.value()),
                    start: mark.start,
                    end: mark.end,
                })
                .collect(),
        },
        PatchAction::Conflict { prop } => PatchOut::Conflict {
            path: path(at, Some(Step::from(prop))),
        },
    }
}

pub fn to_json(patches: &[Patch]) -> serde_json::Result<String> {
    serde_json::to_string(&patches.iter().map(export).collect::<Vec<_>>())
}
