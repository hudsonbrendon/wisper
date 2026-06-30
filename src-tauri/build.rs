fn main() {
    // The `screencapturekit` crate (and its `apple-metal` / `apple-cf`
    // dependencies) ship a small Swift bridge that pulls in the Swift static
    // runtime libraries (`libswiftCompatibility56`,
    // `libswiftCompatibilityConcurrency`, ...). Their build scripts only add the
    // *full Xcode* toolchain Swift path
    // (`.../XcodeDefault.xctoolchain/usr/lib/swift/macosx`) to the linker search
    // path, which does not exist on machines that have only the Command Line
    // Tools. Resolve the active developer directory ourselves and add the Swift
    // macOS runtime path so the linker can find those `.a` files in either
    // environment (CLT-only or full Xcode).
    #[cfg(target_os = "macos")]
    {
        // AVFoundation provides AVCaptureDevice, used to read the Microphone
        // (TCC) authorization status for the Settings permissions panel.
        println!("cargo:rustc-link-lib=framework=AVFoundation");

        if let Some(dir) = swift_runtime_search_path() {
            println!("cargo:rustc-link-search=native={dir}");
        }
        // `libswift_Concurrency.dylib` is part of the OS since macOS 12, so with
        // a deployment target of 12.0+ dyld resolves the bridge's dynamic
        // `@rpath/libswift_Concurrency.dylib` dependency straight from the shared
        // cache (`/usr/lib/swift`). We must NOT add a toolchain rpath here: doing
        // so bakes the *build machine's* absolute Xcode path
        // (`.../Xcode_xx.app/.../swift-5.5/macosx`) into the shipped binary,
        // which then aborts at launch on any Mac without that exact Xcode.
    }

    tauri_build::build()
}

/// Locate the Swift macOS static-runtime library directory for the active
/// developer toolchain, preferring the full Xcode toolchain path and falling
/// back to the Command Line Tools layout. Returns `None` if nothing usable is
/// found (the screencapturekit build scripts still emit their own path, so this
/// is purely additive).
#[cfg(target_os = "macos")]
fn swift_runtime_search_path() -> Option<String> {
    use std::path::Path;
    use std::process::Command;

    let developer_dir = Command::new("xcode-select")
        .arg("-p")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    // Full Xcode: <dev>/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx
    // Command Line Tools: <dev>/usr/lib/swift/macosx
    let candidates = [
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
        format!("{developer_dir}/usr/lib/swift/macosx"),
    ];

    candidates
        .into_iter()
        .find(|p| Path::new(&format!("{p}/libswiftCompatibility56.a")).exists())
}
