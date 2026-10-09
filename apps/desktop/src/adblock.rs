//! The browser's ad and tracker blocker (browser v3, Shaan 7 Oct: "an ad blocker would be great"). The node turns EasyList
//! and EasyPrivacy into WebKit content-blocker rules (services/node/src/adblock.ts); this compiles them once into a
//! WKContentRuleList (WebKit keeps the compiled list on disk by identifier, so later launches only look it up) and attaches
//! it to every browser page, so an ad or a tracker is never fetched. The rules come straight from the local node, never
//! through the app's page, and only this app's own pages are touched.
use std::cell::RefCell;
use std::io::{Read, Write};
use tauri::{AppHandle, Manager, Webview};

#[cfg(target_os = "macos")]
use objc2::{rc::Retained, MainThreadMarker, Message};
#[cfg(target_os = "macos")]
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};

#[cfg(target_os = "macos")]
thread_local! {
    // The compiled list lives on the main thread, where WebKit hands it over and where pages are configured.
    static LIST: RefCell<Option<Retained<WKContentRuleList>>> = const { RefCell::new(None) };
    // The list a newer version replaced, taken off each page as the new one goes on.
    static PREV: RefCell<Option<Retained<WKContentRuleList>>> = const { RefCell::new(None) };
}

fn log(app: &AppHandle, status: &str, detail: serde_json::Value) {
    let line = serde_json::json!({"event":"browser-adblock", "status":status, "detail":detail,
        "at_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()});
    if let Ok(dir) = app.path().app_log_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("node.log")) {
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

/// GET the rules from this app's own node (plain HTTP/1.0 on 127.0.0.1; no client library needed).
fn fetch_rules(port: u16) -> Result<(String, String, u64), String> {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(60))).ok();
    write!(stream, "GET /api/browser/adblock HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n").map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no response")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") { return Err(head.lines().next().unwrap_or("").to_string()); }
    let body: serde_json::Value = serde_json::from_slice(&raw[split + 4..]).map_err(|e| e.to_string())?;
    let version = body["version"].as_str().filter(|v| v.len() <= 64 && v.chars().all(|c| c.is_ascii_alphanumeric())).ok_or("no version")?.to_string();
    let rules = body["rules"].as_str().ok_or("no rules")?.to_string();
    Ok((version, rules, body["count"].as_u64().unwrap_or(0)))
}

/// Attach (or detach) the compiled list on one page. Called on page creation and when the list arrives or is switched off.
#[cfg(target_os = "macos")]
pub(super) fn apply(page: &Webview, on: bool) {
    let _ = page.with_webview(move |native| unsafe {
        let view = &*(native.inner() as *const WKWebView);
        let controller = view.configuration().userContentController();
        PREV.with(|prev| if let Some(prev) = prev.borrow().as_ref() { controller.removeContentRuleList(prev); });
        LIST.with(|list| {
            if let Some(list) = list.borrow().as_ref() {
                controller.removeContentRuleList(list);
                if on { controller.addContentRuleList(list); }
            }
        });
    });
}
#[cfg(not(target_os = "macos"))]
pub(super) fn apply(_page: &Webview, _on: bool) {}

fn pages(app: &AppHandle) -> Vec<Webview> {
    app.webviews().into_iter().filter(|(label, _)| label.starts_with("browser-page-")).map(|(_, w)| w).collect()
}

static ON: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(super) fn on() -> bool { ON.load(std::sync::atomic::Ordering::Relaxed) }

#[cfg(target_os = "macos")]
fn install(app: AppHandle, version: String, rules: String, count: u64) {
    let started = std::time::Instant::now();
    let main = app.clone();
    let _ = main.run_on_main_thread(move || unsafe {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(store) = WKContentRuleListStore::defaultStore(mtm) else { log(&app, "error", serde_json::json!("no rule store")); return };
        let id = objc2_foundation::NSString::from_str(&format!("agent-base-adblock-{version}"));
        let encoded = objc2_foundation::NSString::from_str(&rules);
        let (app2, store2, id2) = (app.clone(), store.clone(), id.clone());
        let ready = move |app: &AppHandle, list: &WKContentRuleList, how: &str| {
            let old = LIST.with(|slot| slot.borrow_mut().replace(list.retain()));
            PREV.with(|prev| *prev.borrow_mut() = old);
            for page in pages(app) { apply(&page, on()); }
            log(app, "ready", serde_json::json!({"how": how, "rules": count, "ms": started.elapsed().as_millis()}));
        };
        let ready = std::rc::Rc::new(ready);
        let compiled = { let ready = ready.clone(); let app = app2.clone(); block2::RcBlock::new(move |list: *mut WKContentRuleList, error: *mut objc2_foundation::NSError| {
            match list.as_ref() {
                Some(list) => ready(&app, list, "compiled"),
                None => log(&app, "error", serde_json::json!(error.as_ref().map(|e| e.localizedDescription().to_string()).unwrap_or_default())),
            }
        }) };
        let found = { let ready = ready.clone(); let app = app2.clone(); block2::RcBlock::new(move |list: *mut WKContentRuleList, _error: *mut objc2_foundation::NSError| {
            match list.as_ref() {
                Some(list) => ready(&app, list, "cached"),
                // Not compiled yet for this version: compile it (a few seconds, off the main thread inside WebKit).
                None => store2.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(Some(&id2), Some(&encoded), Some(&compiled)),
            }
        }) };
        store.lookUpContentRuleListForIdentifier_completionHandler(Some(&id), Some(&found));
    });
}

/// Switch the blocker on (fetch, compile or look up, attach to every page) or off (detach from every page).
#[tauri::command]
pub async fn browser_adblock(caller: Webview, enabled: bool) -> Result<(), String> {
    super::browser::authorized(&caller)?;
    let app = caller.app_handle().clone();
    let was = ON.swap(enabled, std::sync::atomic::Ordering::Relaxed);
    if !enabled {
        for page in pages(&app) { apply(&page, false); }
        log(&app, "off", serde_json::Value::Null);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let loaded = { let (tx, rx) = std::sync::mpsc::channel(); let _ = app.run_on_main_thread(move || { let _ = tx.send(LIST.with(|l| l.borrow().is_some())); }); rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false) };
        if loaded { if !was { for page in pages(&app) { apply(&page, true); } } return Ok(()); }
        let port = super::port();
        let (version, rules, count) = tauri::async_runtime::spawn_blocking(move || fetch_rules(port)).await.map_err(|e| e.to_string())?.map_err(|e| { log(&app, "error", serde_json::json!(e)); e.clone() })?;
        install(app, version, rules, count);
    }
    Ok(())
}
