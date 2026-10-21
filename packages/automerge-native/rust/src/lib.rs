#[cfg(target_os = "android")]
mod android;
mod error;
mod ffi;
mod materialize;
mod objects;
mod ops;
mod patches;
mod protocol;
mod registry;
mod value;

use error::Result;
use protocol::Request;
use registry::{with_registry, Registry};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn run(request: &str) -> Result<String> {
    let request: Request = serde_json::from_str(request)?;
    with_registry(|registry| ops::dispatch(registry, request))
}

fn error_reply(message: &str) -> String {
    serde_json::json!({ "err": message }).to_string()
}

/// Runs one request from the JS shim: a JSON object with an `op` and its
/// arguments. The reply is `{"ok": value}` or `{"err": message}`; a panic in
/// Automerge becomes an error instead of taking the app down.
pub fn call(request: &str) -> String {
    match catch_unwind(AssertUnwindSafe(|| run(request))) {
        Ok(Ok(value)) => format!(r#"{{"ok":{value}}}"#),
        Ok(Err(error)) => error_reply(&error.to_string()),
        Err(_) => {
            with_registry(Registry::poison);
            error_reply("Automerge panicked")
        }
    }
}
