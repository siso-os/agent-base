//! Dev-only native observation. No test command or arbitrary eval is shipped in release builds.
use tauri::{Manager, Webview};

/// The page opened most recently: fixture probes drive one tab at a time.
fn last_page(caller: &Webview) -> Option<Webview> {
    let label = caller.state::<super::browser::BrowserState>().0.lock().ok()?.last.clone()?;
    caller.app_handle().get_webview(&label)
}

#[tauri::command]
pub async fn browser_test_observe(caller: Webview, snapshot: bool, main_snapshot: Option<bool>) -> Result<String, String> {
    super::browser::authorized(&caller)?;
    if std::env::var("AB_BROWSER_FIXTURE").is_err() { return Err("fixture mode required".into()); }
    let page = if main_snapshot == Some(true) { caller.app_handle().get_webview("main") } else { last_page(&caller) }.ok_or("no page")?;
    if snapshot {
        let mut path = std::env::var("AB_BROWSER_SHOT").map_err(|_| "AB_BROWSER_SHOT required")?;
        if main_snapshot == Some(true) { path = path.replace(".tiff", "-main.tiff"); }
        page.with_webview(move |native| unsafe {
            use objc2_app_kit::NSImage;
            use objc2_foundation::{NSError, NSString};
            use objc2_web_kit::WKWebView;
            let view = &*(native.inner() as *const WKWebView);
            let block = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                if let Some(image) = image.as_ref() {
                    if let Some(data) = image.TIFFRepresentation() {
                        data.writeToFile_atomically(&NSString::from_str(&path), true);
                    }
                }
            });
            view.takeSnapshotWithConfiguration_completionHandler(None, &block);
        }).map_err(|e| e.to_string())?;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    page.eval_with_callback("JSON.stringify({url:location.origin+location.pathname,title:document.title,text:document.body?.innerText?.slice(0,2000),cookie:location.hostname==='127.0.0.1'?document.cookie.split(';').filter(c=>c.trim().startsWith('siso_s1')).join(';'):undefined,ua:navigator.userAgent})", move |s| { let _ = tx.send(s); }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn browser_test_status(caller: Webview) -> Result<Vec<i64>, String> {
    super::browser::authorized(&caller)?;
    if std::env::var("AB_BROWSER_FIXTURE").is_err() { return Err("fixture mode required".into()); }
    let page = last_page(&caller).ok_or("no page")?;
    let position = page.position().map_err(|e| e.to_string())?;
    let size = page.size().map_err(|e| e.to_string())?;
    let count = caller.app_handle().webviews().len();
    let (tx, rx) = std::sync::mpsc::channel();
    page.with_webview(move |native| unsafe {
        let view = &*(native.inner() as *const objc2_web_kit::WKWebView);
        let _ = tx.send(!view.isHidden());
    }).map_err(|e| e.to_string())?;
    let shown = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10))).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    // Last: 1 while the page is in the SISO Browser window (t-0439), 0 in Agent Base.
    let popped = i64::from(page.window().label() == super::browser::WINDOW);
    Ok(vec![i64::from(shown), position.x.into(), position.y.into(), size.width.into(), size.height.into(), count as i64, popped])
}

// Bounded media probe in the real child view; unavailable outside debug fixture mode.
#[tauri::command]
pub async fn browser_test_media(caller: Webview, start: bool) -> Result<String, String> {
    super::browser::authorized(&caller)?;
    if std::env::var("AB_BROWSER_FIXTURE").is_err() { return Err("fixture mode required".into()); }
    let page = last_page(&caller).ok_or("no page")?;
    if start {
        page.eval(r#"(async()=>{
            const keys={};
            for(const key of ['com.apple.fps.1_0','com.apple.fps','com.widevine.alpha']) {
                try { await navigator.requestMediaKeySystemAccess(key,[{initDataTypes:['cenc','sinf','skd'],audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'}]}]);keys[key]={supported:true}; }
                catch(e){keys[key]={supported:false,reason:e.name+': '+e.message};}
            }
            window.__s1Media={keys};
            const video=document.querySelector('video');
            if(video){video.muted=true;try{await video.play();}catch(e){window.__s1Media.playError=e.name+': '+e.message;}}
        })()"#).map_err(|e| e.to_string())?;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    page.eval_with_callback(r#"JSON.stringify({url:location.origin+location.pathname,title:document.title,text:document.body?.innerText?.slice(0,1800),probe:window.__s1Media||null,video:(()=>{const v=document.querySelector('video');return v?{currentTime:v.currentTime,paused:v.paused,muted:v.muted,readyState:v.readyState,error:v.error?.message||null}:null})()})"#,move |s|{let _=tx.send(s);}).map_err(|e|e.to_string())?;
    tauri::async_runtime::spawn_blocking(move||rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())?
}

// Fixed identifier step only: no arbitrary script or password input. Debug fixture only.
#[tauri::command]
pub async fn browser_test_google(caller: Webview) -> Result<String, String> {
    super::browser::authorized(&caller)?;
    if std::env::var("AB_BROWSER_FIXTURE").is_err() { return Err("fixture mode required".into()); }
    // The account comes from the environment, never the source (t-0579: the repo goes public).
    let email = std::env::var("AB_GOOGLE_TEST_EMAIL").map_err(|_| "AB_GOOGLE_TEST_EMAIL is not set")?;
    let email = serde_json::to_string(&email).map_err(|e| e.to_string())?;
    let page = last_page(&caller).ok_or("no page")?;
    if !super::browser::is_loaded(caller.app_handle(), page.label()) {
        return Ok(format!("loading: {}", page.url().map_err(|e| e.to_string())?));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    page.eval_with_callback(r#"(()=>{
        if(location.origin!=='https://accounts.google.com')return 'wrong origin';
        const input=document.querySelector('input#identifierId:not([type=password])');
        const next=document.querySelector('#identifierNext');
        if(!input||!next)return JSON.stringify({status:'identifier not ready',url:location.origin+location.pathname,title:document.title,text:document.body?.innerText?.slice(0,2000),inputs:[...document.querySelectorAll('input')].map(e=>({id:e.id,type:e.type}))});
        input.value=EMAIL;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
        next.click();return 'submitted';
    })()"#.replace("EMAIL", &email), move |s| { let _ = tx.send(s); }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Every browser page: its label, whether it is on screen, its address and its frame. Debug fixture only.
#[tauri::command]
pub async fn browser_test_pages(caller: Webview) -> Result<String, String> {
    super::browser::authorized(&caller)?;
    if std::env::var("AB_BROWSER_FIXTURE").is_err() { return Err("fixture mode required".into()); }
    let mut out = vec![];
    for (label, page) in caller.app_handle().webviews() {
        if !label.starts_with("browser-page-") && !label.starts_with("browser-prefetch-") { continue; }
        let (tx, rx) = std::sync::mpsc::channel();
        page.with_webview(move |native| unsafe {
            let view = &*(native.inner() as *const objc2_web_kit::WKWebView);
            let _ = tx.send(!view.isHidden());
        }).map_err(|e| e.to_string())?;
        let shown = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10))).await.map_err(|e| e.to_string())?.unwrap_or(false);
        let at = page.position().map_err(|e| e.to_string())?;
        let size = page.size().map_err(|e| e.to_string())?;
        out.push(serde_json::json!({"label": label, "shown": shown, "url": page.url().map(|u| u.to_string()).unwrap_or_default(), "x": at.x, "w": size.width}));
    }
    Ok(serde_json::Value::Array(out).to_string())
}
