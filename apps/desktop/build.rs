fn main() {
    println!("cargo:rerun-if-changed=native_dictation.swift");
    // The helper is intentionally compiled beside the desktop binary. It owns
    // the macOS event tap/audio APIs, while the Tauri process owns lifecycle.
    #[cfg(target_os = "macos")]
    {
        let out = std::env::var_os("OUT_DIR").expect("OUT_DIR");
        let output = std::path::Path::new(&out).join("agent-base-dictation");
        let status = std::process::Command::new("swiftc")
            .args(["-O", "-framework", "AppKit", "-framework", "AVFoundation", "-framework", "AudioToolbox"])
            .arg("native_dictation.swift")
            .arg("-o")
            .arg(&output)
            .status()
            .expect("swiftc is required to build native dictation");
        assert!(status.success(), "native dictation helper did not compile");
        println!("cargo:rustc-env=AGENT_BASE_DICTATION_HELPER={}", output.display());
        voice_engine(&output);
    }
    tauri_build::build()
}

/// The voice engine ships as its own small app, `Agent Base Voice.app` (t-0505). It carries SISO Voice's bundle id and
/// is signed with SISO Voice's local identity, so macOS keeps the Accessibility, Input Monitoring and Microphone
/// permissions Shaan gave SISO Voice: the engine replaces SISO Voice the way an update would. Without that identity on
/// the machine (CI, the mini) it is signed ad hoc and asks for the permissions once.
#[cfg(target_os = "macos")]
fn voice_engine(helper: &std::path::Path) {
    let app = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/Agent Base Voice.app");
    let macos = app.join("Contents/MacOS");
    std::fs::create_dir_all(&macos).expect("create voice engine bundle");
    std::fs::copy(helper, macos.join("agent-base-dictation")).expect("copy voice engine");
    std::fs::write(app.join("Contents/Info.plist"), r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.siso.voice</string>
<key>CFBundleName</key><string>Agent Base Voice</string>
<key>CFBundleExecutable</key><string>agent-base-dictation</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Agent Base Voice records while you hold Fn or after you press right Option, to write down what you say.</string>
</dict></plist>
"#).expect("write voice engine Info.plist");
    let entitlements = std::path::Path::new(&std::env::var_os("OUT_DIR").expect("OUT_DIR")).join("voice.entitlements");
    std::fs::write(&entitlements, r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.device.audio-input</key><true/></dict></plist>
"#).expect("write voice entitlements");
    let identity = std::env::var("AB_VOICE_SIGN_IDENTITY").unwrap_or_else(|_| "SISO Voice Dev Local".into());
    let known = std::process::Command::new("security").args(["find-identity", "-v", "-p", "codesigning"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{identity}\""))).unwrap_or(false);
    let sign = if known { identity.as_str() } else { "-" };
    let status = std::process::Command::new("codesign")
        .args(["--force", "--options", "runtime", "--sign", sign, "--entitlements"]).arg(&entitlements).arg(&app)
        .status().expect("codesign is required to sign the voice engine");
    assert!(status.success(), "the voice engine did not sign");
    println!("cargo:rerun-if-env-changed=AB_VOICE_SIGN_IDENTITY");
}
