use crate::error::{Error, Result};
use crate::protocol::DocId;
use automerge::AutoCommit;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// The documents JS holds handles to, by id.
#[derive(Default)]
pub struct Registry {
    next: DocId,
    docs: HashMap<DocId, AutoCommit>,
    poisoned: bool,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Mutex::default);

pub fn with_registry<T>(f: impl FnOnce(&mut Registry) -> T) -> T {
    let mut guard = REGISTRY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    f(&mut guard)
}

impl Registry {
    pub fn add(&mut self, doc: AutoCommit) -> Result<DocId> {
        self.check()?;
        self.next += 1;
        self.docs.insert(self.next, doc);
        Ok(self.next)
    }

    pub fn remove(&mut self, id: DocId) {
        self.docs.remove(&id);
    }

    pub fn get(&mut self, id: DocId) -> Result<&mut AutoCommit> {
        self.check()?;
        self.docs.get_mut(&id).ok_or(Error::Freed)
    }

    /// Lends `doc` and `other` together, for operations across two documents.
    pub fn with_pair<T>(
        &mut self,
        doc: DocId,
        other: DocId,
        f: impl FnOnce(&mut AutoCommit, &mut AutoCommit) -> Result<T>,
    ) -> Result<T> {
        self.check()?;
        let mut taken = self.docs.remove(&other).ok_or(Error::Freed)?;
        let result = self.get(doc).and_then(|doc| f(doc, &mut taken));
        self.docs.insert(other, taken);
        result
    }

    fn check(&self) -> Result<()> {
        if self.poisoned {
            Err(Error::Poisoned)
        } else {
            Ok(())
        }
    }

    /// Like a trapped wasm instance: after a panic a document may be half
    /// changed, so none is used again.
    pub fn poison(&mut self) {
        self.docs.clear();
        self.poisoned = true;
    }
}
