use std::slice;

fn into_raw(bytes: Vec<u8>, out_len: *mut usize) -> *mut u8 {
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    // SAFETY: the caller passes a valid pointer for the length it reads back.
    unsafe { out_len.write_unaligned(boxed.len()) };
    std::mem::forget(boxed);
    ptr
}

/// Runs a JSON request and returns the JSON reply, which the caller frees with
/// `nod_am_free`.
///
/// # Safety
/// `request` must point to `request_len` bytes of UTF-8 and `out_len` to a
/// writable `usize`.
#[no_mangle]
pub unsafe extern "C" fn nod_am_call(
    request: *const u8,
    request_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    // Swift hands an empty buffer over as a null pointer.
    let bytes = if request.is_null() {
        &[]
    } else {
        slice::from_raw_parts(request, request_len)
    };
    let reply = match std::str::from_utf8(bytes) {
        Ok(text) => crate::call(text),
        Err(_) => r#"{"err":"the request was not UTF-8"}"#.to_string(),
    };
    into_raw(reply.into_bytes(), out_len)
}

/// Frees a buffer returned by `nod_am_call` or `nod_am_alloc`.
///
/// # Safety
/// `ptr` and `len` must come from one of those functions, freed only once.
#[no_mangle]
pub unsafe extern "C" fn nod_am_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(slice::from_raw_parts_mut(ptr, len)));
    }
}

/// Reserves a buffer a wasm host writes a request into.
#[no_mangle]
pub extern "C" fn nod_am_alloc(len: usize) -> *mut u8 {
    let mut out = 0usize;
    into_raw(vec![0u8; len], std::ptr::from_mut(&mut out))
}

#[cfg(target_arch = "wasm32")]
mod wasm_random {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn host_random(ptr: *mut u8, len: usize);
    }

    // The bare wasm build has no system randomness; the host fills the buffer
    // (Node's crypto in tests). Only new actor ids use it.
    #[no_mangle]
    unsafe extern "Rust" fn __getrandom_v04_custom(
        dest: *mut u8,
        len: usize,
    ) -> Result<(), getrandom::Error> {
        host_random(dest, len);
        Ok(())
    }
}
