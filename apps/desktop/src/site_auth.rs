//! Sites behind a password (HTTP Basic or Digest, like the siso-ui-hub worker). wry's navigation delegate has no
//! authentication-challenge method, so WebKit turned every such prompt away and showed the 401's empty body: a blank page
//! (Shaan, 9 Oct: "I can't open up URLs"). This adds that one method to wry's delegate class before the first browser page
//! is made. A challenge on a browser page is held, the shell is asked (`browser-auth`), and his answer (`browser_auth`)
//! completes it. The password goes from his sheet to WebKit's credential store (the keychain); it is never logged, kept
//! here or sent to the node. A page closed while asking is answered "cancel" first, so WebKit never sees a dropped handler.
use std::{cell::RefCell, collections::HashMap, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex, OnceLock}};
use block2::{Block, RcBlock};
use objc2::{ffi, rc::Retained, runtime::{AnyClass, AnyObject, Imp, Sel}, sel};
use objc2_foundation::{NSInteger, NSString, NSURLAuthenticationChallenge, NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLCredential, NSURLCredentialPersistence};
use tauri::{AppHandle, Emitter, Manager, Webview};

type Answer = Block<dyn Fn(NSInteger, *mut NSURLCredential)>;
// NSURLSessionAuthChallengeDisposition
const USE: NSInteger = 0;
const DEFAULT: NSInteger = 1;
const CANCEL: NSInteger = 2;

/// What the shell needs to ask him: the site and its realm, never a path, query or password.
#[derive(Clone)]
pub struct Ask { id: u64, tab: String, host: String, realm: String, retry: bool }
impl Ask { fn json(&self) -> serde_json::Value { serde_json::json!({ "id": self.id, "tab": self.tab, "host": self.host, "realm": self.realm, "retry": self.retry }) } }

static APP: OnceLock<AppHandle> = OnceLock::new();
static INSTALLED: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// A browser page's label by its WKWebView, so a challenge knows whose it is.
static PAGES: Mutex<Option<HashMap<usize, String>>> = Mutex::new(None);
/// Challenges waiting for him: id → (page label, the question). The handlers themselves live on the main thread.
static ASKS: Mutex<Option<HashMap<u64, (String, Ask)>>> = Mutex::new(None);
thread_local! { static WAITING: RefCell<HashMap<u64, RcBlock<dyn Fn(NSInteger, *mut NSURLCredential)>>> = RefCell::new(HashMap::new()); }

/// Before a browser page is built. wry registers its delegate class with the app's first webview (the shell), and WebKit
/// reads which delegate methods exist when a page's delegate is set, so pages made after this ask him.
pub(super) fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if INSTALLED.load(Ordering::Acquire) { return; }
    // objc2 names wry's class by its Rust path and wry's version ("wry::…::WryNavigationDelegate0.55.1"), so it is found by
    // that path rather than spelled out, and a wry update keeps working.
    let Some(class) = AnyClass::classes().iter().copied().find(|c| c.name().to_str().is_ok_and(|n| n.starts_with("wry::") && n.contains("::WryNavigationDelegate"))) else { return; };
    let selector = sel!(webView:didReceiveAuthenticationChallenge:completionHandler:);
    if class.instance_method(selector).is_some() { INSTALLED.store(true, Ordering::Release); return; }
    let imp: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut NSURLAuthenticationChallenge, *mut Answer) = challenged;
    // SAFETY: the signature matches the WKNavigationDelegate method and its type encoding (void; self, _cmd, 3 objects, a block).
    let added = unsafe { ffi::class_addMethod(class as *const AnyClass as *mut AnyClass, selector, std::mem::transmute::<_, Imp>(imp), c"v@:@@@?".as_ptr()) };
    INSTALLED.store(added.as_bool(), Ordering::Release);
}

/// A new browser page: its WKWebView, so its challenges find their tab.
pub(super) fn remember(page: &Webview, label: &str) {
    let label = label.to_string();
    let _ = page.with_webview(move |native| { if let Ok(mut p) = PAGES.lock() { p.get_or_insert_with(HashMap::new).insert(native.inner() as usize, label); } });
}

unsafe extern "C-unwind" fn challenged(_this: *mut AnyObject, _cmd: Sel, webview: *mut AnyObject, challenge: *mut NSURLAuthenticationChallenge, handler: *mut Answer) {
    let answer = |how: NSInteger, credential: *mut NSURLCredential| { if let Some(h) = unsafe { handler.as_ref() } { h.call((how, credential)); } };
    let Some(challenge) = (unsafe { challenge.as_ref() }) else { return answer(DEFAULT, std::ptr::null_mut()); };
    let space = challenge.protectionSpace();
    let method = space.authenticationMethod();
    let password = unsafe { method.isEqualToString(NSURLAuthenticationMethodHTTPBasic) || method.isEqualToString(NSURLAuthenticationMethodHTTPDigest) };
    let label = PAGES.lock().ok().and_then(|p| p.as_ref()?.get(&(webview as usize)).cloned());
    // Certificates and anything not a browser page: as WebKit would by itself.
    let (true, Some(label), Some(app)) = (password, label, APP.get()) else { return answer(DEFAULT, std::ptr::null_mut()); };
    let retry = challenge.previousFailureCount() > 0;
    // The password he saved for this site last time, until it stops working.
    if !retry {
        if let Some(saved) = challenge.proposedCredential() {
            if saved.hasPassword() { return answer(USE, Retained::as_ptr(&saved) as *mut NSURLCredential); }
        }
    }
    let Some(held) = (unsafe { RcBlock::copy(handler) }) else { return answer(DEFAULT, std::ptr::null_mut()); };
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    WAITING.with(|w| w.borrow_mut().insert(id, held));
    let ask = Ask { id, tab: String::new(), host: space.host().to_string(), realm: space.realm().map(|r| r.to_string()).unwrap_or_default(), retry };
    if let Ok(mut a) = ASKS.lock() { a.get_or_insert_with(HashMap::new).insert(id, (label.clone(), ask)); }
    announce(app, &label);
}

/// Tell the page's shell what is waiting; a prefetched page has no tab yet and is announced when a tab adopts it.
pub(super) fn announce(app: &AppHandle, label: &str) {
    let Some(tab) = super::browser::tab_of(app, label) else { return; };
    let asks: Vec<Ask> = ASKS.lock().ok().map(|a| a.iter().flatten().filter(|(_, (l, _))| l == label).map(|(_, (_, q))| Ask { tab: tab.clone(), ..q.clone() }).collect()).unwrap_or_default();
    for ask in asks { let _ = app.emit_to(super::browser::shell_of(app, label), "browser-auth", ask.json()); }
}

/// What is waiting on this tab, for a shell that mounted after the event.
#[tauri::command]
pub async fn browser_auth_pending(caller: Webview, tab: String) -> Result<Vec<serde_json::Value>, String> {
    super::browser::authorized(&caller)?;
    let app = caller.app_handle();
    let asks: Vec<(String, Ask)> = ASKS.lock().ok().map(|a| a.iter().flatten().map(|(_, v)| v.clone()).collect()).unwrap_or_default();
    Ok(asks.into_iter().filter_map(|(label, ask)| (super::browser::tab_of(app, &label)? == tab).then(|| Ask { tab: tab.clone(), ..ask }.json())).collect())
}

/// His answer: a user and password signs in (every request waiting on the same site and realm), none cancels.
#[tauri::command]
pub async fn browser_auth(caller: Webview, id: u64, user: Option<String>, password: Option<String>) -> Result<(), String> {
    super::browser::authorized(&caller)?;
    let ids: Vec<u64> = {
        let mut guard = ASKS.lock().map_err(|_| "busy")?;
        let asks = guard.get_or_insert_with(HashMap::new);
        let (label, ask) = asks.get(&id).cloned().ok_or("that sign-in is no longer waiting")?;
        let same: Vec<u64> = asks.iter().filter(|(_, (l, q))| *l == label && q.host == ask.host && q.realm == ask.realm).map(|(k, _)| *k).collect();
        for k in &same { asks.remove(k); }
        same
    };
    let credential = match (user, password) { (Some(u), Some(p)) if !u.is_empty() => Some((u, p)), _ => None };
    caller.app_handle().run_on_main_thread(move || complete(&ids, credential)).map_err(|e| e.to_string())
}

/// The keychain in the app; for this run only in a hidden fixture run, so tests leave nothing in the Mac's keychain.
fn keep() -> NSURLCredentialPersistence {
    if cfg!(debug_assertions) && std::env::var("AB_BROWSER_FIXTURE").is_ok() { NSURLCredentialPersistence::ForSession } else { NSURLCredentialPersistence::Permanent }
}

fn complete(ids: &[u64], credential: Option<(String, String)>) {
    let credential = credential.map(|(u, p)| NSURLCredential::credentialWithUser_password_persistence(&NSString::from_str(&u), &NSString::from_str(&p), keep()));
    for id in ids {
        let Some(handler) = WAITING.with(|w| w.borrow_mut().remove(id)) else { continue; };
        match &credential {
            Some(c) => handler.call((USE, Retained::as_ptr(c) as *mut NSURLCredential)),
            None => handler.call((CANCEL, std::ptr::null_mut())),
        }
    }
}

/// A page going away: cancel what it was asking, and forget its WKWebView.
pub(super) fn forget(app: &AppHandle, label: &str) {
    let ids: Vec<u64> = ASKS.lock().ok().map(|mut a| {
        let asks = a.get_or_insert_with(HashMap::new);
        let ids: Vec<u64> = asks.iter().filter(|(_, (l, _))| l == label).map(|(k, _)| *k).collect();
        for k in &ids { asks.remove(k); }
        ids
    }).unwrap_or_default();
    if let Ok(mut p) = PAGES.lock() { if let Some(p) = p.as_mut() { p.retain(|_, l| l != label); } }
    if !ids.is_empty() { let _ = app.run_on_main_thread(move || complete(&ids, None)); }
}
