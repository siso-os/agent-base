//! A module in a window of its own (Shaan, 10 Oct: "right click ... open it in a new window ... a condensed version of
//! literally the same ... just with no icons ... voice, estate, app factory ... even whatsapp"). The window is the same
//! app at `?window=module&m=<id>`: the page draws that one module with no rail, so it is as local and as trusted as SISO OS
//! and remote pages still get nothing. One window per module: asking again shows and focuses it.
use tauri::{LogicalPosition, Manager, TitleBarStyle, Webview, WebviewUrl};

/// A module id from the registry: lower-case words and dashes, short. Anything else is refused before it reaches a URL.
fn module_id(raw: &str) -> Result<&str, String> {
    let ok = !raw.is_empty() && raw.len() <= 40 && raw.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok { Ok(raw) } else { Err("not a module id".into()) }
}

#[tauri::command]
pub async fn module_window(caller: Webview, module: String, title: Option<String>) -> Result<(), String> {
    super::browser::authorized(&caller)?;
    let id = module_id(&module)?;
    let label = format!("mod-{id}");
    let app = caller.app_handle().clone();
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let title: String = title.unwrap_or_else(|| id.to_string()).chars().filter(|c| !c.is_control()).take(80).collect();
    let mut at = caller.url().map_err(|e| e.to_string())?;
    at.set_path("/");
    at.set_fragment(None);
    at.query_pairs_mut().clear().append_pair("window", "module").append_pair("m", id);
    let size = caller.window().inner_size().ok().zip(caller.window().scale_factor().ok()).map(|(s, f)| s.to_logical::<f64>(f));
    tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(at))
        .title(title)
        .inner_size(size.map_or(1280.0, |s| s.width * 0.85), size.map_or(860.0, |s| s.height * 0.9))
        .min_inner_size(640.0, 480.0)
        .center()
        // SISO OS's frame: the traffic lights over the slim bar the page draws (its drag region).
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(16.0, 20.0))
        .disable_drag_drop_handler()
        .focused(true)
        .visible(std::env::var("AB_HIDDEN").as_deref() != Ok("1"))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::module_id;
    #[test]
    fn ids() {
        for ok in ["voice", "app-factory", "agents-hub", "whatsapp", "estate"] { assert!(module_id(ok).is_ok(), "{ok}"); }
        for bad in ["", "Voice", "../x", "a b", "x?y=1", "a#b", &"x".repeat(41)] { assert!(module_id(bad).is_err(), "{bad}"); }
    }
}
