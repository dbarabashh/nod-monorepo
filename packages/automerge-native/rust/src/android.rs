use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JClass, JString};
use jni::EnvUnowned;

/// The JNI entry the Kotlin module calls: one JSON request in, one reply out.
#[no_mangle]
pub extern "system" fn Java_expo_modules_nodautomerge_NodAutomergeModule_nativeCall<'caller>(
    mut unowned_env: EnvUnowned<'caller>,
    _class: JClass<'caller>,
    request: JString<'caller>,
) -> JString<'caller> {
    unowned_env
        .with_env(|env| -> jni::errors::Result<JString<'caller>> {
            let reply = match request.mutf8_chars(env) {
                Ok(text) => crate::call(&String::from(text)),
                Err(_) => r#"{"err":"the request was not a string"}"#.to_string(),
            };
            JString::new(env, &reply).or_else(|_| {
                JString::new(env, r#"{"err":"the reply could not be passed to Java"}"#)
            })
        })
        .resolve::<ThrowRuntimeExAndDefault>()
}
