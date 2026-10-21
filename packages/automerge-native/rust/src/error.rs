use automerge::AutomergeError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Automerge(#[from] AutomergeError),
    #[error("error loading change: {0}")]
    LoadChange(#[from] automerge::LoadChangeError),
    #[error("bad request: {0}")]
    Request(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("the document was freed")]
    Freed,
    #[error("Automerge failed earlier and its documents can no longer be trusted")]
    Poisoned,
}

impl Error {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
