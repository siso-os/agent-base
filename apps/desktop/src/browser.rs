//! One native page per web tab, each on a stable WKWebsiteDataStore. Leaving a tab hides its page; only an
//! explicit close (or the app's sleep policy) destroys it. Remote pages never receive app authority.
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::webview::{DownloadEvent, NewWindowFeatures, NewWindowResponse};
use tauri::{webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

// Shared entrypoint integration: append menu(app), call menu_event on native MenuEvent, and window_state
// on main-window Resized events. No remote key injection and no new remote capability is involved.
pub(super) fn menu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let menu = tauri::menu::Submenu::with_id(app, "browser-menu", "Browser", true)?;
    menu.append(&tauri::menu::MenuItem::with_id(app, "browser-toggle-sidebar", "Toggle Browser Sidebar", false, Some("CmdOrCtrl+S"))?)?;
    menu.append(&tauri::menu::MenuItem::with_id(app, "browser-new-tab", "New Browser Tab", false, Some("CmdOrCtrl+T"))?)?;
    menu.append(&tauri::menu::MenuItem::with_id(app, "browser-spotlight", "Spotlight", false, Some("CmdOrCtrl+K"))?)?;
    for n in 1..=9 {
        menu.append(&tauri::menu::MenuItem::with_id(app, format!("browser-space-{n}"), format!("Switch to Browser Space {n}"), false, Some(format!("Ctrl+{n}")))?)?;
    }
    Ok(menu)
}
fn shortcut_action(id: &str) -> Option<&str> {
    match id.strip_prefix("browser-")? {
        "toggle-sidebar" => Some("toggle-sidebar"),
        "new-tab" => Some("new-tab"),
        "spotlight" => Some("spotlight"),
        action if action.len() == 7 && action.starts_with("space-") && matches!(action.as_bytes()[6], b'1'..=b'9') => Some(action),
        _ => None,
    }
}
pub(super) fn menu_event(app: &AppHandle, id: &str) {
    let Some(action) = shortcut_action(id) else { return; };
    let active = app.state::<BrowserState>().0.lock().ok().and_then(|p| p.active.clone());
    if let Some((label, tab)) = active {
        let _ = app.emit_to(shell_of(app, &label), "browser-shortcut", (tab, action));
    }
}
/// The app windows that host the browser: Agent Base itself, and the SISO Browser window it pops out into (t-0439: "move it
/// over to a new window so I could use the Mac's built-in swipe"). Each is a window whose one app webview has its label.
pub(super) const WINDOW: &str = "browser";
fn is_shell(label: &str) -> bool { label == "main" || label == WINDOW }
/// The shell window a page (or popup) lives in, for events about it; Agent Base when it is gone.
pub(super) fn shell_of(app: &AppHandle, label: &str) -> String {
    app.get_webview(label).map(|w| w.window().label().to_string()).filter(|l| is_shell(l)).unwrap_or_else(|| "main".into())
}
fn mark_visible(app: &AppHandle, tab: &str, label: &str, visible: bool) {
    let enabled = if let Ok(mut pages) = app.state::<BrowserState>().0.lock() {
        if visible { pages.active = Some((label.into(), tab.into())); }
        else if pages.active.as_ref().map(|(active, _)| active.as_str()) == Some(label) { pages.active = None; }
        if pages.tab.contains_key(label) { pages.used.insert(label.into(), Instant::now()); }
        if visible { pages.shown.insert(label.into()); } else { pages.shown.remove(label); }
        pages.active.is_some()
    } else { false };
    if let Some(item) = app.menu().and_then(|menu| menu.get("browser-menu")) {
        if let Some(menu) = item.as_submenu() {
            for item in menu.items().unwrap_or_default() {
                if let Some(item) = item.as_menuitem() { let _ = item.set_enabled(enabled); }
            }
        }
    }
}
/// Cocoa fullscreen does not fire DOM fullscreenchange. Emit only genuine native state transitions.
pub(super) fn window_state(window: &tauri::Window) {
    if !is_shell(window.label()) { return; }
    let Ok(fullscreen) = window.is_fullscreen() else { return; };
    let changed = window.state::<BrowserState>().0.lock().map(|mut p| {
        let changed = p.fullscreen.get(window.label()) != Some(&fullscreen); p.fullscreen.insert(window.label().into(), fullscreen); changed
    }).unwrap_or(false);
    if changed { let _ = window.app_handle().emit_to(window.label(), "browser-window-state", fullscreen); }
}
/// Closing the SISO Browser window brings its pages home: each moves back into Agent Base, hidden and still alive (a sign-in
/// half done, a song playing), and Agent Base hears where each went.
pub(super) fn window_closing(window: &tauri::Window) {
    if window.label() != WINDOW { return; }
    let app = window.app_handle();
    let Some(main) = app.get_window("main") else { return; };
    if let Ok(mut p) = app.state::<BrowserState>().0.lock() { p.prefetch.remove(WINDOW); }
    for page in window.webviews() {
        if is_shell(page.label()) { continue; }
        if page.label().starts_with("browser-prefetch-") { super::site_auth::forget(app, page.label()); let _ = page.close(); continue; }
        let _ = page.hide();
        if page.reparent(&main).is_ok() { moved(app, page.label(), "main"); }
    }
}
/// Tell both shells which window a tab's page now lives in, so the other one stops drawing it.
fn moved(app: &AppHandle, label: &str, to: &str) {
    let Some(tab) = app.state::<BrowserState>().0.lock().ok().and_then(|p| p.tab.get(label).cloned()) else { return; };
    for shell in ["main", WINDOW] { let _ = app.emit_to(shell, "browser-page-moved", (&tab, to)); }
}

/// Per page label: its data store (one per Google account, never per space), whether its current load finished, and the
/// agent driving it, if any; plus the last page opened (dev probes).
#[derive(Default)]
pub struct Pages { active: Option<(String, String)>, fullscreen: HashMap<String, bool>, tab: HashMap<String, String>, alias: HashMap<String, String>, prefetch: HashMap<String, (String, [u8; 16], String)>, store: HashMap<String, [u8; 16]>, loaded: HashMap<String, bool>, loading: HashMap<String, u64>, agent: HashMap<String, String>, reserved_downloads: HashSet<PathBuf>, pub(super) last: Option<String>, used: HashMap<String, Instant>, shown: HashSet<String> }
#[derive(Default)]
pub struct BrowserState(pub Mutex<Pages>);
// Stable UUID bytes, not a session-generated identifier. Separate from the app's store.
const PERSONAL: [u8; 16] = *b"SISO-personal-v1";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/// The tab a page shows (none for a page prefetched on hover until a tab adopts it).
pub(super) fn tab_of(app: &AppHandle, label: &str) -> Option<String> {
    app.state::<BrowserState>().0.lock().ok()?.tab.get(label).cloned()
}
pub(super) fn authorized(caller: &Webview) -> Result<(), String> {
    let url = caller.url().map_err(|e| e.to_string())?;
    let fallback = format!("http://127.0.0.1:{}/", super::port());
    let expected = if cfg!(debug_assertions) && std::env::var("AB_BROWSER_FIXTURE").is_ok() { fallback }
        else { std::env::var("AB_DEV_URL").unwrap_or(fallback) };
    let expected: tauri::Url = expected.parse().map_err(|_| "invalid dev URL")?;
    if !is_shell(caller.label()) || caller.window().label() != caller.label() || url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "localhost")) || url.origin() != expected.origin() {
        return Err("browser commands are only available to the main app".into());
    }
    Ok(())
}
fn url(raw: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = raw.parse().map_err(|_| "invalid URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("use an HTTP(S) URL without credentials".into());
    }
    Ok(url)
}
fn store_id(profile: &str) -> Result<[u8; 16], String> {
    if profile.is_empty() || profile.len() > 160 || profile.chars().any(char::is_control) { return Err("invalid browser profile".into()); }
    if profile == "personal" { return Ok(PERSONAL); }
    let digest = Sha256::digest(format!("siso.agent-base.browser.profile.v1:{profile}"));
    let mut id = [0; 16];
    id.copy_from_slice(&digest[..16]);
    Ok(id)
}
fn rect(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if [x, y, width, height].iter().any(|n| !n.is_finite()) || x < 0.0 || y < 0.0 || width <= 0.0 || height <= 0.0 {
        return Err("invalid browser rectangle".into());
    }
    Ok(())
}
/// A tab key (the app's tab id and space) as a stable native label; labels allow only a few characters.
fn label(tab: &str) -> Result<String, String> {
    if tab.is_empty() || tab.len() > 600 || tab.chars().any(char::is_control) { return Err("invalid browser tab".into()); }
    let digest = Sha256::digest(format!("siso.agent-base.browser.tab.v1:{tab}"));
    Ok(format!("browser-page-{}", digest[..10].iter().map(|b| format!("{b:02x}")).collect::<String>()))
}
/// An agent name as the app writes it (WIDGET-MAP, ESTATE): it names a folder, so nothing else gets through.
fn agent_name(agent: Option<String>) -> Result<Option<String>, String> {
    match agent {
        Some(a) if a.is_empty() || a.len() > 64 || !a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') => Err("invalid agent".into()),
        other => Ok(other),
    }
}
fn agent_of(app: &AppHandle, label: &str) -> Option<String> {
    app.state::<BrowserState>().0.lock().ok()?.agent.get(label).cloned()
}
static POPUPS: AtomicU32 = AtomicU32::new(0);
static SESSION_PROBES: AtomicU32 = AtomicU32::new(0);
const POPUP: (f64, f64) = (480.0, 640.0);
/// Where a popup goes: centred over the opener page (logical screen points), from the window's inner origin and the page's
/// place in it.
pub(super) fn centred(window: (f64, f64), page: (f64, f64, f64, f64), popup: (f64, f64)) -> (f64, f64) {
    (window.0 + page.0 + ((page.2 - popup.0) / 2.0).max(0.0), window.1 + page.1 + ((page.3 - popup.1) / 2.0).max(0.0))
}
/// A page's window.open (Sign in with Google, OAuth): a real small window on the opener's own configuration, so it shares
/// the account's store and `window.opener` survives to receive the result. It is a child of the app window, centred on the
/// opener page, and a popup from an agent's tab never takes focus. It closes itself when the flow calls close().
fn popup(app: &AppHandle, opener: &str, url: &tauri::Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if !matches!(url.scheme(), "http" | "https") { return NewWindowResponse::Deny; }
    let agent = agent_of(app, opener);
    // A plain new window from his page (target=_blank, window.open with no size) is a new tab: the app opens it in the
    // Web space. A sized one is a sign-in popup and needs its opener, so it stays a window over the page.
    if agent.is_none() && features.size().is_none() {
        let _ = app.emit_to(shell_of(app, opener), "browser-new-tab", url.as_str());
        return NewWindowResponse::Deny;
    }
    let label = format!("{opener}-popup-{}", POPUPS.fetch_add(1, Ordering::Relaxed));
    let mut builder = tauri::WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().expect("static URL")))
        .window_features(features)
        .inner_size(POPUP.0, POPUP.1)
        .user_agent(UA)
        .title(url.host_str().unwrap_or("Sign in"))
        .focused(agent.is_none())
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"))
        .on_download(downloads(app.clone(), opener.to_string()));
    if let (Some(main), Some(page)) = (app.get_webview_window(&shell_of(app, opener)), app.get_webview(opener)) {
        let place = (|| -> tauri::Result<(f64, f64)> {
            let scale = main.scale_factor()?;
            let origin = main.inner_position()?.to_logical::<f64>(scale);
            let (at, size) = (page.position()?.to_logical::<f64>(scale), page.size()?.to_logical::<f64>(scale));
            Ok(centred((origin.x, origin.y), (at.x, at.y, size.width, size.height), POPUP))
        })();
        if let Ok((x, y)) = place { builder = builder.position(x, y); }
        builder = match builder.parent(&main) {
            Ok(attached) => attached,
            Err(_) => { let _ = page.navigate(url.clone()); return NewWindowResponse::Deny; }
        };
    }
    let built = builder.build();
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => {
            if let Some(page) = app.get_webview(opener) { let _ = page.navigate(url.clone()); }
            NewWindowResponse::Deny
        }
    }
}
/// The file name only (never a path from the site), made unique in the folder. Reservations live for this process because
/// macOS completion does not report a path and therefore cannot safely release a lease.
pub(super) fn download_path(dir: &Path, suggested: Option<&std::ffi::OsStr>, url: &tauri::Url, reserved: &mut HashSet<PathBuf>) -> PathBuf {
    let from_url = url.path_segments().and_then(|mut s| s.next_back()).filter(|s| !s.is_empty()).map(str::to_owned);
    let raw = suggested.and_then(|n| n.to_str()).map(str::to_owned).or(from_url).unwrap_or_else(|| "download".into());
    let mut name: String = Path::new(&raw).file_name().and_then(|n| n.to_str()).unwrap_or("download")
        .chars().map(|c| if c.is_control() || c == '/' || c == ':' { '_' } else { c }).collect();
    // Leave room for collision suffixes under the usual 255-byte component limit.
    let suffix_at = name.rfind('.').filter(|&i| i > 0 && name.len() - i <= 32).unwrap_or(name.len());
    let suffix = name[suffix_at..].to_owned();
    name.truncate(suffix_at);
    while name.len() + suffix.len() > 200 { name.pop(); }
    name.push_str(&suffix);
    let name = if name.trim_matches('.').is_empty() { "download".to_string() } else { name };
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()), _ => (name.clone(), String::new()) };
    let mut path = dir.join(&name);
    let mut n = 1;
    while path.exists() || reserved.contains(&path) { path = dir.join(format!("{stem} ({n}){ext}")); n += 1; }
    reserved.insert(path.clone());
    path
}
/// His downloads land in ~/Downloads; an agent's in ~/Downloads/Agents/<AGENT>/.
pub(super) fn download_dir(home: &Path, agent: Option<&str>) -> PathBuf {
    let dir = home.join("Downloads");
    match agent { Some(a) => dir.join("Agents").join(a), None => dir }
}
/// The download handler for a page (and its popups): the app hears "started" and "finished" with the file name only, never
/// the URL, plus the agent whose tab it was. Payload: [phase, file name, ok, agent | null].
fn downloads(app: AppHandle, opener: String) -> impl Fn(Webview, DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    move |_page, event| {
        let agent = agent_of(&app, &opener);
        match event {
            DownloadEvent::Requested { url, destination } => {
                let Some(home) = std::env::var_os("HOME") else { return false };
                let dir = download_dir(Path::new(&home), agent.as_deref());
                if std::fs::create_dir_all(&dir).is_err() { return false; }
                let state = app.state::<BrowserState>();
                {
                    let Ok(mut pages) = state.0.lock() else { return false };
                    *destination = download_path(&dir, destination.file_name(), &url, &mut pages.reserved_downloads);
                }
                let name = destination.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
                let _ = app.emit_to(shell_of(&app, &opener), "browser-download", ("started", name, true, agent));
                true
            }
            DownloadEvent::Finished { path, success, .. } => {
                let name = path.as_deref().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("file").to_string();
                let _ = app.emit_to(shell_of(&app, &opener), "browser-download", ("finished", name, success, agent));
                true
            }
            _ => true,
        }
    }
}
/// Native callbacks survive a hidden tab. No URL, profile, cookie or raw WebKit error reaches the log.
fn load_log(app: &AppHandle, label: &str, status: &str) {
    use std::io::Write;
    let line = serde_json::json!({"event":"browser-load", "tab":label, "status":status,
        "at_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()});
    if let Ok(dir) = app.path().app_log_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("node.log")) {
                let _ = writeln!(file, "{line}");
            }
        }
    }
}
static LOADS: AtomicU64 = AtomicU64::new(0);
fn begin_load(app: &AppHandle, label: &str) {
    let generation = if let Ok(mut pages) = app.state::<BrowserState>().0.lock() {
        pages.loaded.insert(label.into(), false);
        let generation = LOADS.fetch_add(1, Ordering::Relaxed);
        pages.loading.insert(label.into(), generation);
        generation
    } else { return; };
    load_log(app, label, "started");
    let (app, label) = (app.clone(), label.to_owned());
    tauri::async_runtime::spawn(async move {
        // A missing finish is observable, but is not evidence of a particular network error.
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_secs(30))).await.ok();
        let pending = app.state::<BrowserState>().0.lock().map(|p|
            p.loading.get(&label) == Some(&generation) && p.loaded.get(&label) == Some(&false)).unwrap_or(false);
        if pending { load_log(&app, &label, "timeout-no-finish"); }
    });
}
fn set_loaded(app: &AppHandle, label: &str, loaded: bool) {
    if let Ok(mut pages) = app.state::<BrowserState>().0.lock() { pages.loaded.insert(label.into(), loaded); }
}
pub(super) fn is_loaded(app: &AppHandle, label: &str) -> bool {
    app.state::<BrowserState>().0.lock().map(|p| p.loaded.get(label).copied().unwrap_or(false)).unwrap_or(false)
}
/// The chat mic (t-0100): wry grants every page's mic and camera once macOS said yes to the app, so pages he browses
/// here get no media devices at all.
const NO_MEDIA: &str = "try{Object.defineProperty(Navigator.prototype,'mediaDevices',{get:()=>undefined,configurable:false})}catch(e){}";
fn page(caller: &Webview, tab: &str) -> Result<Webview, String> {
    authorized(caller)?;
    caller.app_handle().get_webview(&resolve(caller.app_handle(), &label(tab)?)).ok_or_else(|| "no browser page".into())
}
/// A tab's page: its own label, or the page prefetched on hover that it adopted (t-0494).
fn resolve(app: &AppHandle, base: &str) -> String {
    let aliased = app.state::<BrowserState>().0.lock().ok().and_then(|p| p.alias.get(base).cloned());
    match aliased { Some(l) if app.get_webview(&l).is_some() => l, _ => base.to_string() }
}
/// Hold a prefetched page's sound and video until it is adopted (WebKit's own switch: the page cannot start them either).
fn hold_media(page: &Webview, hold: bool) {
    #[cfg(target_os = "macos")]
    let _ = page.with_webview(move |native| unsafe {
        let view = &*(native.inner() as *const objc2_web_kit::WKWebView);
        view.setAllMediaPlaybackSuspended_completionHandler(hold, None);
    });
    #[cfg(not(target_os = "macos"))]
    let _ = (page, hold);
}
static PREFETCHES: AtomicU32 = AtomicU32::new(0);
/// One page per window, loading what the pointer rests on (Shaan, 7 Oct: "they should be super zippy"): off-screen, hidden,
/// silent, on the profile the click would use. A click on that address adopts it (`browser_open`), so it has been loading
/// for as long as he took to click. Hovering another address reuses it; a different profile replaces it.
#[tauri::command]
pub async fn browser_prefetch(caller: Webview, raw_url: String, profile: String, width: f64, height: f64) -> Result<(), String> {
    authorized(&caller)?;
    rect(0.0, 0.0, width, height)?;
    let url = url(&raw_url)?;
    let store = store_id(&profile)?;
    let app = caller.app_handle().clone();
    let here = caller.window().label().to_string();
    let current = app.state::<BrowserState>().0.lock().ok().and_then(|p| p.prefetch.get(&here).cloned());
    if let Some((old, old_store, old_url)) = current {
        if let Some(page) = app.get_webview(&old) {
            if old_store == store {
                if old_url != url.as_str() {
                    set_loaded(&app, &old, false);
                    page.navigate(url.clone()).map_err(|e| e.to_string())?;
                    if let Ok(mut p) = app.state::<BrowserState>().0.lock() { p.prefetch.insert(here, (old, store, url.to_string())); }
                }
                return Ok(());
            }
            super::site_auth::forget(&app, &old);
            let _ = page.close();
        }
        if let Ok(mut p) = app.state::<BrowserState>().0.lock() { p.store.remove(&old); p.loaded.remove(&old); p.loading.remove(&old); }
    }
    let label = format!("browser-prefetch-{}", PREFETCHES.fetch_add(1, Ordering::Relaxed));
    if let Ok(mut p) = app.state::<BrowserState>().0.lock() {
        p.store.insert(label.clone(), store);
        p.loaded.insert(label.clone(), false);
        p.prefetch.insert(here, (label.clone(), store, url.to_string()));
    }
    // Rendering while hidden, so the adopted page is painted, not just fetched.
    let builder = build(&app, &label, url, store).background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    let page = caller.window().add_child(builder, LogicalPosition::new(20000.0, 0.0), LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    super::site_auth::remember(&page, &label);
    let _ = page.hide();
    hold_media(&page, true);
    if super::adblock::on() { super::adblock::apply(&page, true); }
    Ok(())
}
/// The page if it lives in the caller's window. A tab moved to the other window is that window's to place, show, hide,
/// close and steer; the shell it left gets `None` and leaves it alone (it hears `browser-page-moved` and stops drawing it).
fn mine(caller: &Webview, tab: &str) -> Result<Option<Webview>, String> {
    let page = page(caller, tab)?;
    Ok((page.window().label() == caller.window().label()).then_some(page))
}
/// A page on its profile's store: no media devices, its load state, its popups and downloads in its own place.
fn build(app: &AppHandle, label: &str, url: tauri::Url, store: [u8; 16]) -> WebviewBuilder<tauri::Wry> {
    let label = label.to_string();
    let (nav_app, nav_label) = (app.clone(), label.clone());
    let (load_label, popup_app, popup_label) = (label.clone(), app.clone(), label.clone());
    // Before the page's delegate is made: password sites ask him instead of showing a blank 401.
    super::site_auth::install(app);
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .user_agent(UA)
        // wry grants every page's mic and camera request once macOS has said yes to the app (for the chat mic), so
        // the pages he browses here get no media devices at all.
        .initialization_script_for_all_frames(NO_MEDIA)
        .on_navigation(move |u| {
            let allowed = matches!(u.scheme(), "http" | "https");
            if allowed { begin_load(&nav_app, &nav_label); }
            allowed
        })
        .on_page_load(move |page, payload| {
            let finished = matches!(payload.event(), tauri::webview::PageLoadEvent::Finished);
            set_loaded(page.app_handle(), &load_label, finished);
            if finished { load_log(page.app_handle(), &load_label, "finished"); }
        })
        .on_new_window(move |url, features| popup(&popup_app, &popup_label, &url, features))
        .on_download(downloads(app.clone(), label.clone()));
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(store);
    #[cfg(not(target_os = "macos"))]
    let _ = store;
    builder
}

// Async commands avoid the macOS synchronous IPC / main-thread child creation deadlock.
#[tauri::command]
/// `profile` is the Google account whose store the page uses (a space only points at one); `agent` marks a tab an agent
/// drives: it is never throttled in the background, and its popups and downloads follow the rules above.
pub async fn browser_open(caller: Webview, tab: String, raw_url: String, profile: String, x: f64, y: f64, width: f64, height: f64, agent: Option<String>) -> Result<(), String> {
    authorized(&caller)?;
    rect(x, y, width, height)?;
    let url = url(&raw_url)?;
    let store = store_id(&profile)?;
    let agent = agent_name(agent)?;
    let base = label(&tab)?;
    let app = caller.app_handle().clone();
    let mut label = resolve(&app, &base);
    if let Some(existing) = app.get_webview(&label) {
        let same = app.state::<BrowserState>().0.lock().map(|p| p.store.get(&label) == Some(&store) && p.agent.get(&label) == agent.as_ref()).unwrap_or(false);
        // The tab's page is still awake (a re-mount, an app reload, or the tab moving between windows): show it as it is,
        // without reloading. Moving keeps the live page (its sign-in, its video), not just its address.
        if same {
            let here = caller.window();
            if existing.window().label() != here.label() {
                existing.hide().map_err(|e| e.to_string())?;
                existing.reparent(&here).map_err(|e| e.to_string())?;
                moved(&app, &label, here.label());
            }
            existing.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            existing.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            existing.show().map_err(|e| e.to_string())?;
            mark_visible(&app, &tab, &label, true);
            sweep(&app);
            return Ok(());
        }
        let elsewhere = existing.window().label() != caller.window().label();
        super::site_auth::forget(&app, &label);
        existing.close().map_err(|e| e.to_string())?;
        if elsewhere { moved(&app, &label, caller.window().label()); }
        if label != base { if let Ok(mut p) = app.state::<BrowserState>().0.lock() { p.alias.remove(&base); } label = base.clone(); }
    }
    // The page prefetched on hover for this address and profile (t-0494) becomes this tab's page: it has been loading since
    // the pointer arrived. Never for an agent's tab (its page is made unthrottled, with its own downloads folder).
    if agent.is_none() {
        let here = caller.window().label().to_string();
        let ready = app.state::<BrowserState>().0.lock().ok().and_then(|mut p| match p.prefetch.get(&here) {
            Some((l, s, u)) if *s == store && *u == url.as_str() => { let l = l.clone(); p.prefetch.remove(&here); Some(l) }
            _ => None,
        });
        if let Some(page) = ready.and_then(|l| app.get_webview(&l)) {
            let adopted = page.label().to_string();
            if let Ok(mut p) = app.state::<BrowserState>().0.lock() {
                p.alias.insert(base.clone(), adopted.clone());
                p.tab.insert(adopted.clone(), tab.clone());
                p.agent.remove(&adopted);
                p.last = Some(adopted.clone());
            }
            super::site_auth::announce(&app, &adopted);
            hold_media(&page, false);
            page.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            page.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            page.show().map_err(|e| e.to_string())?;
            mark_visible(&app, &tab, &adopted, true);
            sweep(&app);
            return Ok(());
        }
    }
    if let Ok(mut pages) = app.state::<BrowserState>().0.lock() {
        pages.store.insert(label.clone(), store);
        pages.tab.insert(label.clone(), tab.clone());
        pages.loaded.insert(label.clone(), false);
        match &agent { Some(a) => { pages.agent.insert(label.clone(), a.clone()); } None => { pages.agent.remove(&label); } }
        pages.last = Some(label.clone());
    }
    let builder = build(&app, &label, url, store);
    // An agent's tab keeps running while hidden, as a tab playing sound does.
    let builder = if agent.is_some() { builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled) } else { builder };
    #[cfg(debug_assertions)]
    let builder = if std::env::var("AB_HIDDEN").as_deref() == Ok("1") { builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled) } else { builder };
    let page = caller.window().add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    super::site_auth::remember(&page, &label);
    // The ad blocker before the page's first ads are asked for (the document itself is never an ad).
    if super::adblock::on() { super::adblock::apply(&page, true); }
    mark_visible(&app, &tab, &label, true);
    sweep(&app);
    Ok(())
}
#[tauri::command]
pub async fn browser_bounds(caller: Webview, tab: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    rect(x, y, width, height)?;
    let Some(page) = mine(&caller, &tab)? else { return Ok(()) };
    page.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    page.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_visible(caller: Webview, tab: String, visible: bool) -> Result<(), String> {
    let Some(page) = mine(&caller, &tab)? else { return Ok(()) };
    (if visible { page.show() } else { page.hide() }).map_err(|e| e.to_string())?;
    mark_visible(caller.app_handle(), &tab, page.label(), visible);
    if !visible { sweep(caller.app_handle()); }
    Ok(())
}
#[tauri::command]
pub async fn browser_close(caller: Webview, tab: String) -> Result<(), String> {
    authorized(&caller)?;
    let base = label(&tab)?;
    let label = resolve(caller.app_handle(), &base);
    if let Some(page) = caller.app_handle().get_webview(&label) { if page.window().label() != caller.window().label() { return Ok(()); } }
    if let Ok(mut pages) = caller.state::<BrowserState>().0.lock() { pages.alias.remove(&base); }
    if let Ok(mut pages) = caller.state::<BrowserState>().0.lock() {
        pages.store.remove(&label);
        pages.tab.remove(&label);
        pages.loaded.remove(&label);
        pages.loading.remove(&label);
        pages.agent.remove(&label);
        pages.used.remove(&label);
        if pages.last.as_deref() == Some(label.as_str()) { pages.last = None; }
    }
    mark_visible(caller.app_handle(), &tab, &label, false);
    super::site_auth::forget(caller.app_handle(), &label);
    if let Some(page) = caller.app_handle().get_webview(&label) { page.close().map_err(|e| e.to_string())?; }
    Ok(())
}
/// The SISO Browser window (t-0439): `open` shows it with this tab (making it the first time), focused, so the tab's page
/// moves over when the window mounts it; `open: false` closes it, which brings its pages back (`window_closing`). The window
/// is the same app at `?window=browser`, so it is as local and as trusted as Agent Base, and remote pages still get nothing.
#[tauri::command]
pub async fn browser_window(caller: Webview, open: bool, tab: Option<String>, raw_url: Option<String>, title: Option<String>) -> Result<(), String> {
    authorized(&caller)?;
    let app = caller.app_handle().clone();
    if !open {
        if let Some(window) = app.get_window(WINDOW) { window.close().map_err(|e| e.to_string())?; }
        return Ok(());
    }
    let tab = tab.filter(|t| label(t).is_ok());
    let raw_url = raw_url.filter(|u| url(u).is_ok()).unwrap_or_default();
    let title: String = title.unwrap_or_default().chars().filter(|c| !c.is_control()).take(200).collect();
    if let Some(window) = app.get_webview_window(WINDOW) {
        if let Some(tab) = &tab { window.emit_to(WINDOW, "browser-window-tab", (tab, &raw_url, &title)).map_err(|e| e.to_string())?; }
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut at = caller.url().map_err(|e| e.to_string())?;
    at.set_path("/");
    at.set_fragment(None);
    {
        let mut q = at.query_pairs_mut();
        q.clear().append_pair("window", WINDOW);
        if let Some(tab) = &tab { q.append_pair("tab", tab).append_pair("url", &raw_url).append_pair("title", &title); }
    }
    let size = caller.window().inner_size().ok().zip(caller.window().scale_factor().ok()).map(|(s, f)| s.to_logical::<f64>(f));
    tauri::WebviewWindowBuilder::new(&app, WINDOW, WebviewUrl::External(at))
        .title("SISO Browser")
        .inner_size(size.map_or(1280.0, |s| s.width), size.map_or(860.0, |s| s.height))
        .min_inner_size(720.0, 480.0)
        .center()
        // As in Agent Base: the page's own drag and drop (folders, Today) needs wry's file-drop handler off.
        .disable_drag_drop_handler()
        .focused(true)
        // A hidden test run (AB_HIDDEN=1) shows nothing, this window included.
        .visible(std::env::var("AB_HIDDEN").as_deref() != Ok("1"))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn browser_navigate(caller: Webview, tab: String, raw_url: String) -> Result<(), String> {
    let Some(page) = mine(&caller, &tab)? else { return Ok(()) };
    let url = url(&raw_url)?;
    set_loaded(caller.app_handle(), page.label(), false);
    page.navigate(url).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_action(caller: Webview, tab: String, action: String) -> Result<(), String> {
    let script = match action.as_str() {
        "back" => "history.back()", "forward" => "history.forward()", "reload" => "location.reload()",
        // The speaker on a Today row: mutes the page's playing media (browser_audio then reads it as silent).
        "mute" => "document.querySelectorAll('audio,video').forEach(m=>{m.muted=true})",
        // The mini player's ⏯ (arc-edges §5.6): pause what plays and mark it, so play resumes only what was paused here.
        "pause" => "document.querySelectorAll('audio,video').forEach(m=>{if(!m.paused){m.pause();m.dataset.abPaused='1'}})",
        "play" => "document.querySelectorAll('[data-ab-paused]').forEach(m=>{delete m.dataset.abPaused;m.play().catch(()=>{})})",
        _ => return Err("unknown browser action".into()),
    };
    let Some(page) = mine(&caller, &tab)? else { return Ok(()) };
    page.eval(script).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_url(caller: Webview, tab: String) -> Result<String, String> {
    let Some(page) = mine(&caller, &tab)? else { return Ok(String::new()) };
    if !is_loaded(caller.app_handle(), page.label()) { return Ok(String::new()); }
    Ok(page.url().map_err(|e| e.to_string())?.to_string())
}
/// The page's own title (WKWebView's `title`, no script run in the page), so a tab and its row read "YouTube", not a host.
#[tauri::command]
pub async fn browser_title(caller: Webview, tab: String) -> Result<String, String> {
    let Some(page) = mine(&caller, &tab)? else { return Ok(String::new()) };
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        page.with_webview(move |native| unsafe {
            let view = &*(native.inner() as *const objc2_web_kit::WKWebView);
            let _ = tx.send(view.title().map(|t| t.to_string()).unwrap_or_default());
        }).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = page; Ok(String::new()) }
}
// A bounded identity probe: only Google's signed-in account avatar, no arbitrary evaluation API.
#[tauri::command]
pub async fn browser_google_account(caller: Webview, tab: String) -> Result<String, String> {
    let page = page(&caller, &tab)?;
    let current = page.url().map_err(|e| e.to_string())?;
    if current.scheme() != "https" || !matches!(current.host_str(), Some("accounts.google.com" | "myaccount.google.com" | "mail.google.com")) {
        return Ok(String::new());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    page.eval_with_callback(include_str!("browser-google-account.js"), move |value| { let _ = tx.send(value); }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}
/// Google's session cookie names, on a cookie whose domain covers `host`: their presence, never a value, says the account
/// is signed in. Domain-match as browsers do (equal, or `host` ends with `.domain`): Google sets them on `.google.com`, so
/// wry's `cookies_for_url`, which wants the cookie's domain to equal the host exactly, never saw them (2 Oct: every
/// account read "Needs sign-in" while signed in).
#[cfg(test)]
pub(super) fn google_signed_in<'a>(cookies: impl IntoIterator<Item = (&'a str, Option<&'a str>)>, host: &str) -> bool {
    session_proof(cookies, host).0
}
/// The proof behind "Signed in" (Accounts hub, t-0242): which of Google's session cookie names the store holds and how
/// many cookies it has for Google, by name and domain only. Never a value. Sent as (signed in, names, count).
pub type SessionProof = (bool, Vec<String>, usize);
pub(super) fn session_proof<'a>(cookies: impl IntoIterator<Item = (&'a str, Option<&'a str>)>, host: &str) -> SessionProof {
    let covers = |domain: Option<&str>| { let d = domain.unwrap_or("").trim_start_matches('.'); !d.is_empty() && (host == d || host.ends_with(&format!(".{d}"))) };
    let mut names = Vec::new();
    let mut count = 0;
    for (name, domain) in cookies {
        if !covers(domain) { continue; }
        count += 1;
        if matches!(name, "SID" | "__Secure-1PSID" | "__Secure-3PSID") && !names.iter().any(|n: &String| n == name) { names.push(name.to_string()); }
    }
    names.sort();
    (!names.is_empty(), names, count)
}
/// Where the session cookies live: Google, or (debug fixture runs only) a local page that sets a fake `SID`.
fn session_url() -> tauri::Url {
    #[cfg(debug_assertions)]
    if std::env::var("AB_BROWSER_FIXTURE").is_ok() {
        if let Some(u) = std::env::var("AB_BROWSER_SESSION_URL").ok().and_then(|u| u.parse().ok()) { return u; }
    }
    "https://accounts.google.com/".parse().expect("static URL")
}
/// Is this account's store signed in to Google? Reads cookie names through a live page on the store or, if none is awake, a
/// hidden 1 × 1 page on it that loads nothing. Returns the proof (cookie names and a count), never a value.
#[tauri::command]
pub async fn browser_session_state(caller: Webview, account: String) -> Result<SessionProof, String> {
    authorized(&caller)?;
    let store = store_id(&account)?;
    let app = caller.app_handle().clone();
    let google = session_url();
    let host = google.host_str().unwrap_or_default();
    let live = app.state::<BrowserState>().0.lock().ok().and_then(|p| p.store.iter().find(|(_, s)| **s == store).map(|(l, _)| l.clone()));
    if let Some(page) = live.and_then(|l| app.get_webview(&l)) {
        let cookies = page.cookies().map_err(|e| e.to_string())?;
        return Ok(session_proof(cookies.iter().map(|c| (c.name(), c.domain())), host));
    }
    let probe = format!("browser-session-{}-{}", label(&account)?.trim_start_matches("browser-page-"), SESSION_PROBES.fetch_add(1, Ordering::Relaxed));
    // A blank page from this app's own node: a real load starts the store's network session, which is where its saved
    // cookies are read from disk (about:blank never does, so a store with no awake page always read signed out).
    let blank: tauri::Url = format!("http://127.0.0.1:{}/api/browser/blank", super::port()).parse().map_err(|_| "invalid blank URL")?;
    let (tx, rx) = std::sync::mpsc::channel();
    let builder = WebviewBuilder::new(&probe, WebviewUrl::External(blank)).on_page_load(move |_, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { let _ = tx.send(()); }
    });
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(store);
    let page = caller.window().add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)).map_err(|e| e.to_string())?;
    let _ = page.hide();
    // Read once the blank page has loaded (or after 3 s if the node did not answer).
    let _ = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(3))).await;
    let cookies = page.cookies();
    let _ = page.close();
    Ok(session_proof(cookies.map_err(|e| e.to_string())?.iter().map(|c| (c.name(), c.domain())), host))
}
/// Whether the tab is playing sound, so the sleep policy never closes music. A fixed probe; it returns only a boolean.
#[tauri::command]
pub async fn browser_audio(caller: Webview, tab: String) -> Result<bool, String> {
    let Some(page) = mine(&caller, &tab)? else { return Ok(false) };
    playing(&page).await
}
async fn playing(page: &Webview) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    page.eval_with_callback("[...document.querySelectorAll('audio,video')].some(m=>!m.paused&&!m.ended&&!m.muted&&m.volume>0&&m.readyState>2)", move |value| { let _ = tx.send(value); }).map_err(|e| e.to_string())?;
    let value = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(3)).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??;
    Ok(value.trim() == "true")
}
/// The awake cap, kept natively as well (t-0574, Shaan 9 Oct: "It shouldn't be like this heavy"). Agent Base's own list of
/// awake pages is forgotten on every reload and release while their native pages live on: 50 tabs held 58 WebKit processes
/// and 26 GB. Beyond AWAKE tab pages the longest-unseen hidden ones sleep, never one on screen, an agent's, or one playing
/// sound (WebKit keeps an audible page answering, so one that cannot say in 3 s is not playing). Agent Base hears each
/// (`browser-page-slept`) and rebuilds it from its address when opened, as for its own sleep.
const AWAKE: usize = 8;
static SWEEPING: AtomicBool = AtomicBool::new(false);
fn sweep(app: &AppHandle) {
    if SWEEPING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { sleep_oldest(&app).await; SWEEPING.store(false, Ordering::SeqCst); });
}
fn idle(p: &Pages, label: &str) -> bool {
    !p.shown.contains(label) && !p.agent.contains_key(label) && p.active.as_ref().map(|(a, _)| a.as_str()) != Some(label)
}
async fn sleep_oldest(app: &AppHandle) {
    let state = app.state::<BrowserState>();
    let Some(mut pages) = state.0.lock().ok().map(|p| p.tab.keys().map(|l| (p.used.get(l).copied(), l.clone())).collect::<Vec<_>>()) else { return };
    pages.retain(|(_, l)| app.get_webview(l).is_some());
    let mut excess = pages.len().saturating_sub(AWAKE);
    if excess == 0 { return; }
    pages.sort();
    for (_, label) in pages {
        if excess == 0 { break; }
        if !state.0.lock().map(|p| idle(&p, &label)).unwrap_or(false) { continue; }
        let Some(page) = app.get_webview(&label) else { excess -= 1; continue };
        if playing(&page).await.unwrap_or(false) { continue; }
        let tab = {
            let Ok(mut p) = state.0.lock() else { return };
            // Shown again, or handed to an agent, while it was asked about sound.
            if !idle(&p, &label) { continue; }
            p.alias.retain(|_, l| l != &label);
            p.store.remove(&label);
            p.loaded.remove(&label);
            p.loading.remove(&label);
            p.used.remove(&label);
            if p.last.as_deref() == Some(label.as_str()) { p.last = None; }
            p.tab.remove(&label)
        };
        super::site_auth::forget(app, &label);
        let _ = page.close();
        excess -= 1;
        if let Some(tab) = tab { for shell in ["main", WINDOW] { let _ = app.emit_to(shell, "browser-page-slept", &tab); } }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_shortcuts_are_bounded_browser_commands() {
        assert_eq!(shortcut_action("browser-toggle-sidebar"), Some("toggle-sidebar"));
        assert_eq!(shortcut_action("browser-new-tab"), Some("new-tab"));
        assert_eq!(shortcut_action("browser-spotlight"), Some("spotlight"));
        for n in 1..=9 { assert_eq!(shortcut_action(&format!("browser-space-{n}")), Some(format!("space-{n}").as_str())); }
        for id in ["save", "browser-space-0", "browser-space-10", "browser-space-a", "browser-back", "browser-reload", "browser-space-1;evil"] { assert_eq!(shortcut_action(id), None); }
    }
    #[test]
    fn profiles_are_stable_and_separate() {
        assert_eq!(store_id("personal").unwrap(), PERSONAL);
        assert_eq!(store_id("HALO").unwrap(), store_id("HALO").unwrap());
        assert_ne!(store_id("HALO").unwrap(), store_id("personal").unwrap());
        let named = "profile:12345678-1234-1234-1234-123456789abc";
        assert_eq!(store_id(named).unwrap(), store_id(named).unwrap());
        assert_ne!(store_id(named).unwrap(), store_id("HALO").unwrap());
        assert_ne!(store_id(named).unwrap(), store_id("arc:space-fake-personal").unwrap());
        assert!(store_id("").is_err());
    }
    #[test]
    fn each_tab_and_space_has_its_own_stable_page() {
        let a = label("tab:abc#personal").unwrap();
        assert_eq!(a, label("tab:abc#personal").unwrap());
        assert_ne!(a, label("tab:abc#HALO").unwrap());
        assert_ne!(a, label("tab:abd#personal").unwrap());
        assert!(a.starts_with("browser-page-") && a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        assert!(label("page:https://example.com/a?b=c#personal").unwrap().len() < 40);
        assert!(label("").is_err());
        assert!(label("tab\n").is_err());
    }
    #[test]
    fn agents_downloads_and_popups_have_their_own_place() {
        let home = Path::new("/Users/fake");
        assert_eq!(download_dir(home, None), home.join("Downloads"));
        assert_eq!(download_dir(home, Some("WIDGET-MAP")), home.join("Downloads/Agents/WIDGET-MAP"));
        assert_eq!(agent_name(Some("WIDGET-MAP".into())).unwrap().as_deref(), Some("WIDGET-MAP"));
        assert!(agent_name(Some("../evil".into())).is_err() && agent_name(Some(String::new())).is_err());
        assert_eq!(agent_name(None).unwrap(), None);
        assert_eq!(centred((100.0, 50.0), (300.0, 40.0, 1100.0, 800.0), POPUP), (100.0 + 300.0 + 310.0, 50.0 + 40.0 + 80.0));
        assert_eq!(centred((0.0, 0.0), (0.0, 0.0, 300.0, 300.0), POPUP), (0.0, 0.0));
    }
    #[test]
    fn signed_in_is_read_from_cookie_names_only() {
        let host = "accounts.google.com";
        assert!(google_signed_in([("NID", Some(".google.com")), ("__Secure-1PSID", Some(".google.com"))], host));
        assert!(google_signed_in([("SID", Some("google.com"))], host), "the domain cookie Google really sets");
        assert!(google_signed_in([("SID", Some("accounts.google.com"))], host));
        assert!(!google_signed_in([("NID", Some(".google.com")), ("AEC", Some(".google.com")), ("SIDCC", Some(".google.com"))], host));
        assert!(!google_signed_in([("SID", Some(".evilgoogle.com")), ("SID", Some("mail.google.com")), ("SID", None), ("SID", Some("."))], host));
        assert!(!google_signed_in([], host));
        assert!(google_signed_in([("SID", Some("127.0.0.1"))], "127.0.0.1"), "the local fixture's host-only cookie");
        let proof = session_proof([("SID", Some(".google.com")), ("NID", Some(".google.com")), ("__Secure-1PSID", Some(".google.com")), ("SID", Some("accounts.google.com")), ("SID", Some(".evilgoogle.com"))], host);
        assert_eq!(proof, (true, vec!["SID".into(), "__Secure-1PSID".into()], 4), "names once each, Google's cookies only");
        assert_eq!(session_proof([("NID", Some(".google.com"))], host), (false, vec![], 1));
        // Spaces never have a store: two spaces on one account reach the same store through the account id.
        assert_eq!(store_id("chrome:Default").unwrap(), store_id("chrome:Default").unwrap());
        assert_ne!(store_id("chrome:Default").unwrap(), store_id("chrome:Profile 7").unwrap());
    }
    #[test]
    fn downloads_keep_only_a_safe_unique_file_name() {
        let dir = std::env::temp_dir().join(format!("ab-dl-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let url: tauri::Url = "https://files.invalid/a/report.pdf?x=1".parse().unwrap();
        let mut reserved = HashSet::new();
        assert_eq!(download_path(&dir, None, &url, &mut reserved), dir.join("report.pdf"));
        std::fs::write(dir.join("report.pdf"), b"fake").unwrap();
        assert_eq!(download_path(&dir, Some(std::ffi::OsStr::new("report.pdf")), &url, &mut reserved), dir.join("report (1).pdf"));
        assert_eq!(download_path(&dir, Some(std::ffi::OsStr::new("../../etc/passwd")), &url, &mut reserved), dir.join("passwd"));
        assert_eq!(download_path(&dir, Some(std::ffi::OsStr::new("..")), &"https://x.invalid/".parse().unwrap(), &mut reserved), dir.join("download"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn rejects_unsafe_urls_and_rectangles() {
        for raw in ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "not a URL"] { assert!(url(raw).is_err()); }
        assert!(url("https://accounts.google.com/").is_ok());
        assert!(url("http://127.0.0.1:5499/").is_ok());
        assert!(rect(0.0, 40.0, 900.0, 700.0).is_ok());
        assert!(rect(0.0, 0.0, f64::NAN, 1.0).is_err());
        assert!(rect(0.0, 0.0, 0.0, 1.0).is_err());
    }
}
