use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

/// The JNI entry the Kotlin module calls: one JSON request in, one reply out.
#[no_mangle]
pub extern "system" fn Java_expo_modules_nodautomerge_NodAutomergeModule_nativeCall<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    request: JString<'local>,
) -> jstring {
    let reply = match env.get_string(&request) {
        Ok(text) => crate::call(&String::from(text)),
        Err(_) => r#"{"err":"the request was not a string"}"#.to_string(),
    };
    env.new_string(reply)
        .or_else(|_| env.new_string(r#"{"err":"the reply could not be passed to Java"}"#))
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
