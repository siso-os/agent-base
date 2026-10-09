//! The Agent Base window.
//!
//! Adapted from SISO Internal's shell (`apps/siso-internal/codebase/src-tauri/src/lib.rs`): find Node, start the
//! local service unless one is already answering, wait for it to bind, log to the app's log folder, and stop it when
//! the app quits. Here the service is the laptop node (`services/node`), which also serves the built screens, so the
//! window simply opens the node's address: `/api` and the terminal sockets are then the same origin.
//!
//! Phase 1 runs from the checkout: the node and the built screens are found beside this crate, not bundled.
//!
//! Environment, for tests: `AB_PORT` picks the node's port (default 5401); `AB_HERDR` is passed through so a test
//! node can drive an isolated lab session; `AB_HIDDEN=1` creates the window without showing it.

use std::{
    fs::{self, OpenOptions},
    io,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, PredefinedMenuItem, Submenu},
    LogicalPosition, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
};

mod adblock;
mod browser;
mod site_auth;
#[cfg(all(debug_assertions, target_os = "macos", feature = "browser-test"))]
mod browser_test;

struct NodeProcess(Mutex<Option<Child>>);

struct NativeDictationProcess(Mutex<Option<Child>>);

#[tauri::command]
fn dictation_paste(app: tauri::AppHandle, caller: tauri::Webview, text: String, bundle_id: Option<String>) -> Result<(), String> {
    browser::authorized(&caller)?;
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let helper = app.path().resource_dir().ok().map(|dir| dir.join("Agent Base Voice.app/Contents/MacOS/agent-base-dictation"))
            .filter(|path| path.is_file()).unwrap_or_else(|| PathBuf::from(env!("AGENT_BASE_DICTATION_HELPER")));
        let mut child = Command::new(helper).arg("--paste-only").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        let payload = serde_json::json!({"text": text, "bundleId": bundle_id});
        child.stdin.take().ok_or("helper stdin unavailable")?.write_all(payload.to_string().as_bytes()).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if output.status.success() { Ok(()) } else { Err("native paste helper failed".into()) }
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (text, bundle_id); Err("dictation paste is only available on macOS".into()) }
}

/// Voice installed as its own launchd job (tools/ab-switch install-voice, t-0539) runs whether or not this app does, so
/// the app never starts a second one.
#[cfg(target_os = "macos")]
fn voice_runs_on_its_own() -> bool {
    std::env::var_os("HOME").map(|home| Path::new(&home).join("Library/LaunchAgents/com.siso.agent-base.voice.plist").is_file()).unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn launch_native_dictation(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("AB_DICTATION_DISABLE").as_deref() == Ok("1") || voice_runs_on_its_own() { return Ok(()); }
    let helper = app.path().resource_dir().ok().map(|dir| dir.join("Agent Base Voice.app/Contents/MacOS/agent-base-dictation"))
        .filter(|path| path.is_file()).unwrap_or_else(|| PathBuf::from(env!("AGENT_BASE_DICTATION_HELPER")));
    let child = Command::new(helper)
        .env("AB_PORT", port().to_string())
        .env("AB_PARENT_PID", std::process::id().to_string())
        .env_remove("HERDR_ENV")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
    *app.state::<NativeDictationProcess>().0.lock().map_err(|_| io::Error::other("dictation lock poisoned"))? = Some(child);
    Ok(())
}

fn stop_native_dictation(app: &tauri::AppHandle) {
    if let Ok(mut slot) = app.state::<NativeDictationProcess>().0.lock() {
        if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); }
    }
}

fn port() -> u16 {
    std::env::var("AB_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5401)
}

fn node_is_ready(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn node_executable() -> Option<PathBuf> {
    let mut candidates = vec![];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(Path::new(&home).join(".local/bin/node"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/opt/node@22/bin/node"));
    candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
    candidates.push(PathBuf::from("/usr/local/bin/node"));
    candidates.into_iter().find(|candidate| candidate.is_file())
}

/// The repo root, from where this crate was built (phase 1 runs from the checkout).
/// The checkout the app runs its node and web dist from. A release built elsewhere (a worktree on the mini) sets
/// AB_REPO_ROOT at build time to the laptop's main checkout, so the installed app never points at a build folder.
fn repo_root() -> PathBuf {
    match option_env!("AB_REPO_ROOT") {
        Some(root) => PathBuf::from(root),
        None => Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    }
}

fn launch_node(app: &tauri::App, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    if node_is_ready(port) {
        return Ok(());
    }
    let node_dir = repo_root().join("services/node");
    let server = node_dir.join("src/server.ts");
    if !server.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("the laptop node is missing: {}", server.display())).into());
    }
    let node = node_executable().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Node.js 22 is required for the laptop node"))?;

    let log_dir = app.path().app_log_dir()?;
    fs::create_dir_all(&log_dir)?;
    let stdout = OpenOptions::new().create(true).append(true).open(log_dir.join("node.log"))?;
    let stderr = stdout.try_clone()?;

    let mut command = Command::new(node);
    command
        .args(["--experimental-strip-types", "--no-warnings"])
        .args(if std::env::var("AB_DEV").as_deref() == Ok("1") { vec!["--watch"] } else { vec![] })
        .arg(&server)
        .current_dir(&node_dir)
        .env("AB_PORT", port.to_string())
        .env("AB_WEB_DIST", repo_root().join("apps/web/dist"))
        // The Servers page's probes and the Tokens page's remote reads (ssh, herdr --remote, quota-axi, spend-ledger):
        // only the app's own node runs them; a node a check starts never sets this.
        .env("AB_SERVERS_PROBE", "1")
        // Only the estate's explicitly configured remote sessions are read; no remote control is exposed.
        .env("AB_REMOTE_INVENTORY", "1")
        // The node exits when this pid is gone, so a crash or kill of the app leaves no orphan.
        .env("AB_PARENT_PID", std::process::id().to_string())
        // The Mac mini group's read-only ssh (services/node/src/mini-lanes.ts) runs only for the app's own node, never a test's.
        .env("AB_MINI_LANES", "1")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    // herdr's pane identity must not leak in: launched from inside a herdr pane, it would point the node at that pane.
    for key in ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"] {
        command.env_remove(key);
    }
    let mut child = command.spawn()?;

    for _ in 0..50 {
        if node_is_ready(port) {
            *app.state::<NodeProcess>().0.lock().map_err(|_| io::Error::other("node process lock poisoned"))? = Some(child);
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!("the laptop node exited during startup: {status} (see {})", log_dir.join("node.log").display())).into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(io::Error::new(io::ErrorKind::TimedOut, format!("the laptop node did not bind 127.0.0.1:{port} within 5 seconds")).into())
}

fn stop_node(app: &tauri::AppHandle) {
    if let Ok(mut slot) = app.state::<NodeProcess>().0.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// A menu without Close Window: ⌘W closes the open agent tab in the page, not the whole window. Edit keeps copy and
/// paste working in the terminal.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "Agent Base",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?])?;
    let browser_menu = browser::menu(app)?;
    Menu::with_items(app, &[&app_menu, &edit, &browser_menu, &window])
}

/// Finder launches discard stdout/stderr. Keep native runtime diagnostics across relaunches.
#[cfg(unix)]
fn desktop_output(app: &tauri::App) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    extern "C" { fn dup2(old: i32, new: i32) -> i32; }
    let dir = app.path().app_log_dir().map_err(io::Error::other)?;
    fs::create_dir_all(&dir)?;
    let file = OpenOptions::new().create(true).append(true).open(dir.join("desktop.log"))?;
    // dup2 owns the new descriptors; closing File leaves stdout and stderr open.
    if unsafe { dup2(file.as_raw_fd(), 1) } < 0 || unsafe { dup2(file.as_raw_fd(), 2) } < 0 {
        return Err(io::Error::last_os_error());
    }
    eprintln!("desktop-start pid={}", std::process::id());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(all(debug_assertions, target_os = "macos", feature = "browser-test"))]
    let builder = builder.invoke_handler(tauri::generate_handler![dictation_paste, browser::browser_open, browser::browser_bounds,
        browser::browser_visible, browser::browser_close, browser::browser_navigate,
        browser::browser_action, browser::browser_url, browser::browser_title, browser::browser_google_account, browser::browser_audio, browser::browser_session_state, browser::browser_window, browser::browser_prefetch, site_auth::browser_auth, site_auth::browser_auth_pending, adblock::browser_adblock, browser_test::browser_test_observe, browser_test::browser_test_status, browser_test::browser_test_pages, browser_test::browser_test_media, browser_test::browser_test_google]);
    #[cfg(not(all(debug_assertions, target_os = "macos", feature = "browser-test")))]
    let builder = builder.invoke_handler(tauri::generate_handler![dictation_paste, browser::browser_open, browser::browser_bounds,
        browser::browser_visible, browser::browser_close, browser::browser_navigate,
        browser::browser_action, browser::browser_url, browser::browser_title, browser::browser_google_account, browser::browser_audio, browser::browser_session_state, browser::browser_window, browser::browser_prefetch, site_auth::browser_auth, site_auth::browser_auth_pending, adblock::browser_adblock]);
    builder
        .manage(NodeProcess(Mutex::new(None)))
        .manage(NativeDictationProcess(Mutex::new(None)))
        .manage(browser::BrowserState::default())
        .menu(menu)
        .on_menu_event(|app, event| browser::menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Resized(_)) {
                browser::window_state(window);
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                browser::window_closing(window);
            }
        })
        .setup(|app| {
            #[cfg(unix)]
            desktop_output(app)?;
            let port = port();
            let hidden = std::env::var("AB_HIDDEN").as_deref() == Ok("1");
            // A hidden test run shows nothing at all: no window and no Dock icon.
            #[cfg(target_os = "macos")]
            if hidden {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            #[cfg(debug_assertions)]
            let fixture = std::env::var("AB_BROWSER_FIXTURE").ok();
            #[cfg(not(debug_assertions))]
            let fixture: Option<String> = None;
            // Neither failure may take the window down (8 Oct 19:08-19:16: node exited 1, this hook returned the error and tao
            // panicked in did_finish_launching, four times). The page says what is wrong and reconnects; the log has why.
            if fixture.is_none() {
                if let Err(error) = launch_node(app, port) { eprintln!("agent-base: the laptop node did not start: {error}"); }
            }
            #[cfg(target_os = "macos")]
            if fixture.is_none() {
                if let Err(error) = launch_native_dictation(app) { eprintln!("agent-base: voice did not start: {error}"); }
            }
            let url = if let Some(path) = fixture {
                format!("http://127.0.0.1:{port}/{path}")
            } else {
                std::env::var("AB_DEV_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}/"))
            }.parse()?;
            // Codex's frame: no title text, the traffic lights over the 40 px bar the screens draw themselves.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Agent Base")
                .inner_size(1440.0, 920.0)
                .min_inner_size(1080.0, 700.0)
                .center()
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(LogicalPosition::new(16.0, 20.0))
                // The page's own drag and drop (browser folders, Today, files into chat). With Tauri's file-drop handler on,
                // wry answers every macOS drag itself and WKWebView never sees it, so `dragover`/`drop` never fire (6 Oct
                // 22:10: "you should be able to drag and drop them into certain folders but you can't"). Nothing here uses
                // Tauri's native drop events; dropped files still reach the page as `dataTransfer.files`.
                .disable_drag_drop_handler()
                .visible(!hidden);
            #[cfg(debug_assertions)]
            let window = if hidden { window.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled) } else { window };
            #[cfg(all(debug_assertions, feature = "browser-test"))]
            let window = if std::env::var("AB_BROWSER_FIXTURE").is_ok() {
                window.initialization_script("window.addEventListener('error',e=>fetch('/progress',{method:'POST',body:JSON.stringify({error:e.message})}));window.addEventListener('DOMContentLoaded',()=>fetch('/progress',{method:'POST',body:JSON.stringify({loaded:location.href,text:document.body.innerText.slice(0,300)})}));")
            } else { window };
            window.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Base")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                stop_node(app);
                stop_native_dictation(app);
            }
        });
}
