// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discord;
mod settings;
mod shortcuts;
mod tray;

pub use commands::{AppState, TrackMetadata};

use std::sync::atomic::Ordering;
use tauri::{Manager, WindowEvent};

use discord::DiscordRpc;
use settings::AppSettings;

/// Script de inicialización, estilos y módulos inyectados en YouTube Music
const INIT_SCRIPT: &str = concat!(
    "(function ZumicInit() {\n",
    "  if (window !== window.top) return;\n",
    "  if (window.location.hostname !== 'music.youtube.com') return;\n",
    "  if (window.__ZUMIC_INITIALIZED__) return;\n",
    "  window.__ZUMIC_INITIALIZED__ = true;\n",
    "  const ZUMIC_STYLES = `",
    include_str!("../../scripts/styles.css"),
    "`;\n",
    include_str!("../../scripts/modules/presence.js"),
    "\n",
    include_str!("../../scripts/modules/adblocker.js"),
    "\n",
    include_str!("../../scripts/modules/background.js"),
    "\n",
    include_str!("../../scripts/modules/volume.js"),
    "\n",
    include_str!("../../scripts/modules/power-saver.js"),
    "\n",
    include_str!("../../scripts/modules/av-switcher.js"),
    "\n",
    include_str!("../../scripts/init.js"),
    "\n})();"
);

/// Verifica si una URL pertenece a los dominios permitidos dentro de la WebView
fn is_allowed_navigation_url(url: &tauri::Url) -> bool {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return true;
    }

    let host = url.host_str().unwrap_or("");
    let is_google_domain = host == "google.com"
        || host.ends_with(".google.com")
        || host.starts_with("google.")
        || host.contains(".google.");

    host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtu.be"
        || host.ends_with(".youtu.be")
        || is_google_domain
        || host.ends_with("googleapis.com")
        || host.ends_with("gstatic.com")
        || host.ends_with("googleusercontent.com")
        || host.ends_with("ytimg.com")
        || host.ends_with("ggpht.com")
        || host.ends_with("1e100.net")
}

/// Construye y configura la ventana principal de la aplicación
fn setup_main_window(app: &tauri::App) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::External("https://music.youtube.com".parse().unwrap()),
    )
    .title("Zumic — YouTube Music")
    .inner_size(1200.0, 800.0)
    .min_inner_size(500.0, 600.0)
    .resizable(true)
    .fullscreen(false)
    .decorations(true)
    .transparent(false)
    .center()
    .on_navigation(|url| {
        if !is_allowed_navigation_url(url) {
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", url.as_str()])
                .spawn();
            return false;
        }
        true
    })
    .initialization_script(INIT_SCRIPT)
    .on_page_load(|window, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            let host = payload.url().host_str().unwrap_or("");
            if host == "music.youtube.com" {
                let _ = window.eval(INIT_SCRIPT);
            } else if host == "www.youtube.com"
                || host == "m.youtube.com"
                || host == "myaccount.google.com"
            {
                let path = payload.url().path();
                let is_auth_step = path.starts_with("/signin")
                    || path.starts_with("/account")
                    || path.starts_with("/Account")
                    || path.starts_with("/CheckCookie")
                    || path.starts_with("/SetSID");
                if !is_auth_step {
                    let _ = window.eval("window.location.replace('https://music.youtube.com');");
                }
            }
        }
    })
    .build()?;

    Ok(())
}

fn main() {
    env_logger::init();

    let discord = DiscordRpc::new();

    tauri::Builder::default()
        .plugin(shortcuts::build_shortcut_plugin())
        .manage(AppState::new(discord))
        .invoke_handler(tauri::generate_handler![
            commands::update_presence,
            commands::clear_presence,
            commands::get_settings,
            commands::set_minimize_to_tray
        ])
        .setup(|app| {
            let initial_settings = AppSettings::load(app.handle());
            {
                let state = app.state::<AppState>();
                state
                    .minimize_on_close
                    .store(initial_settings.minimize_to_tray_on_close, Ordering::Relaxed);
                if let Ok(mut s) = state.settings.lock() {
                    *s = initial_settings.clone();
                };
            }

            setup_main_window(app)?;
            tray::setup_tray(app, initial_settings.minimize_to_tray_on_close)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                tray::save_volume_in_webview(app);

                if state.minimize_on_close.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(wv) = app.get_webview_window("main") {
                        let _ = wv.eval("window.zumic?.setAutoPowerSaver?.(true);");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Error al iniciar la aplicación Zumic");
}
