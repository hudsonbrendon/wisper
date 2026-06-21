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
        if let Some(dir) = swift_runtime_search_path() {
            println!("cargo:rustc-link-search=native={dir}");
        }
        // The Swift bridge also pulls a *dynamic* dependency on
        // `libswift_Concurrency.dylib`. On a Command-Line-Tools-only machine the
        // back-deployment dynamic runtime lives under `swift-5.5/macosx` and is
        // not in dyld's default search set, so executables abort at load time
        // with "Library not loaded: @rpath/libswift_Concurrency.dylib". Add that
        // directory to the runtime rpath so dyld can resolve it.
        if let Some(dir) = swift_dynamic_runtime_path() {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
        }
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

/// Locate the directory holding the *dynamic* Swift back-deployment runtime
/// (`libswift_Concurrency.dylib`) for the active toolchain. Used to set an
/// rpath so executables can load it at runtime. Returns `None` if not found
/// (e.g. when the runtime is already provided by the dyld shared cache).
#[cfg(target_os = "macos")]
fn swift_dynamic_runtime_path() -> Option<String> {
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

    let candidates = [
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx"),
        format!("{developer_dir}/usr/lib/swift-5.5/macosx"),
        format!("{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
        format!("{developer_dir}/usr/lib/swift/macosx"),
    ];

    candidates
        .into_iter()
        .find(|p| Path::new(&format!("{p}/libswift_Concurrency.dylib")).exists())
}
