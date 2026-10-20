// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discord;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use discord::DiscordRpc;

/// Ajustes persistentes de usuario de Zumic
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
    pub minimize_to_tray_on_close: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray_on_close: true,
        }
    }
}

impl AppSettings {
    pub fn load(app: &tauri::AppHandle) -> Self {
        if let Ok(config_dir) = app.path().app_config_dir() {
            let file = config_dir.join("settings.json");
            if let Ok(content) = std::fs::read_to_string(file) {
                if let Ok(settings) = serde_json::from_str(&content) {
                    return settings;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self, app: &tauri::AppHandle) {
        if let Ok(config_dir) = app.path().app_config_dir() {
            let _ = std::fs::create_dir_all(&config_dir);
            let file = config_dir.join("settings.json");
            if let Ok(json) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(file, json);
            }
        }
    }
}

/// Metadata de la pista actual de YouTube Music
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_url: String,
    pub is_playing: bool,
    pub duration_secs: f64,
    pub current_time_secs: f64,
    #[serde(default)]
    pub track_url: String,
}

/// Estado global compartido para el cliente de Discord RPC y ajustes
pub struct AppState {
    pub discord: Mutex<DiscordRpc>,
    pub settings: Mutex<AppSettings>,
    pub minimize_on_close: AtomicBool,
}

/// Comando Tauri asíncrono: actualiza el Rich Presence en un hilo secundario sin bloquear la UI
#[tauri::command]
async fn update_presence(
    metadata: TrackMetadata,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut discord = state.discord.lock().map_err(|e| e.to_string())?;
    discord.update(&metadata).map_err(|e| e.to_string())
}

/// Comando Tauri asíncrono: limpia el Rich Presence sin bloquear la UI
#[tauri::command]
async fn clear_presence(state: State<'_, AppState>) -> Result<(), String> {
    let mut discord = state.discord.lock().map_err(|e| e.to_string())?;
    discord.clear().map_err(|e| e.to_string())
}

/// Comando Tauri: obtiene los ajustes actuales
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

/// Comando Tauri: actualiza la preferencia de minimizar a la bandeja al presionar X
#[tauri::command]
fn set_minimize_to_tray(
    enabled: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.minimize_on_close.store(enabled, Ordering::Relaxed);
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    settings.minimize_to_tray_on_close = enabled;
    settings.save(&app);
    Ok(())
}

/// Snippets JS robustos para control de reproducción garantizado
const JS_TOGGLE_PLAY: &str = r#"
(() => {
    try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.getPlayerState === 'function') {
            if (p.getPlayerState() === 1) { p.pauseVideo(); } else { p.playVideo(); }
            return;
        }
    } catch (_) {}
    const btn = document.querySelector('ytmusic-player-bar #play-pause-button') || document.querySelector('#play-pause-button');
    if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
        return;
    }
    const v = document.querySelector('video');
    if (v) { if (v.paused) v.play(); else v.pause(); }
})();
"#;

const JS_NEXT_TRACK: &str = r#"
(() => {
    try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.nextVideo === 'function') {
            p.nextVideo();
            return;
        }
    } catch (_) {}
    const btn = document.querySelector('ytmusic-player-bar .next-button') || document.querySelector('.next-button');
    if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
    }
})();
"#;

const JS_PREV_TRACK: &str = r#"
(() => {
    try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.previousVideo === 'function') {
            p.previousVideo();
            return;
        }
    } catch (_) {}
    const btn = document.querySelector('ytmusic-player-bar .previous-button') || document.querySelector('.previous-button');
    if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
    }
})();
"#;

fn main() {
    env_logger::init();

    // Inicializar el cliente Discord RPC
    let discord = DiscordRpc::new();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([
                    "MediaPlayPause",
                    "MediaTrackNext",
                    "MediaTrackPrevious",
                    "MediaStop",
                    "F7",
                    "F8",
                    "F9",
                ])
                .unwrap_or_else(|e| {
                    log::warn!("Error al registrar atajos globales: {}", e);
                    tauri_plugin_global_shortcut::Builder::new()
                })
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                    if event.state == ShortcutState::Pressed {
                        if shortcut.matches(Modifiers::empty(), Code::MediaPlayPause)
                            || shortcut.matches(Modifiers::empty(), Code::F8)
                        {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(JS_TOGGLE_PLAY);
                            }
                        } else if shortcut.matches(Modifiers::empty(), Code::MediaTrackNext)
                            || shortcut.matches(Modifiers::empty(), Code::F9)
                        {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(JS_NEXT_TRACK);
                            }
                        } else if shortcut.matches(Modifiers::empty(), Code::MediaTrackPrevious)
                            || shortcut.matches(Modifiers::empty(), Code::F7)
                        {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(JS_PREV_TRACK);
                            }
                        } else if shortcut.matches(Modifiers::empty(), Code::MediaStop) {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(
                                    "const p = document.querySelector('#movie_player'); if (p && p.pauseVideo) p.pauseVideo();",
                                );
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            discord: Mutex::new(discord),
            settings: Mutex::new(AppSettings::default()),
            minimize_on_close: AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            update_presence,
            clear_presence,
            get_settings,
            set_minimize_to_tray
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

            let _window = tauri::WebviewWindowBuilder::new(
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
                let host = url.host_str().unwrap_or("");
                let is_allowed = host.ends_with("youtube.com")
                    || host.ends_with("google.com")
                    || host.ends_with("googleapis.com")
                    || host.ends_with("gstatic.com");

                if !is_allowed {
                    let _ = std::process::Command::new("rundll32")
                        .args(["url.dll,FileProtocolHandler", url.as_str()])
                        .spawn();
                    return false;
                }
                true
            })
            .initialization_script(include_str!("../../scripts/init.js"))
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let init_script = include_str!("../../scripts/init.js");
                    let _ = window.eval(init_script);
                }
            })
            .build()?;

            // --- Menú de la bandeja del sistema (Tray) ---
            let show_item = MenuItem::with_id(app, "show", "Mostrar / Ocultar", true, None::<&str>)?;
            let play_pause_item =
                MenuItem::with_id(app, "play_pause", "Reproducir / Pausar", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next", "Siguiente canción", true, None::<&str>)?;
            let prev_item = MenuItem::with_id(app, "prev", "Canción anterior", true, None::<&str>)?;
            let saver_item =
                MenuItem::with_id(app, "toggle_saver", "Modo Ahorro (Solo Audio): Alternar", true, None::<&str>)?;
            let close_to_tray_item = CheckMenuItem::with_id(
                app,
                "toggle_close_to_tray",
                "Minimizar a la bandeja al presionar (X)",
                true,
                initial_settings.minimize_to_tray_on_close,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir de Zumic", true, None::<&str>)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&play_pause_item)
                .item(&next_item)
                .item(&prev_item)
                .separator()
                .item(&saver_item)
                .separator()
                .item(&close_to_tray_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = app.default_window_icon().cloned().expect("Icono por defecto no encontrado");
            let close_item_clone = close_to_tray_item.clone();

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Zumic — YouTube Music")
                .on_menu_event(move |app_handle, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                                let _ = window.eval("window.zumic?.setAutoPowerSaver?.(true);");
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.eval("window.zumic?.setAutoPowerSaver?.(false);");
                            }
                        }
                    }
                    "play_pause" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval(JS_TOGGLE_PLAY);
                        }
                    }
                    "next" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval(JS_NEXT_TRACK);
                        }
                    }
                    "prev" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval(JS_PREV_TRACK);
                        }
                    }
                    "toggle_saver" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval("window.zumic?.toggleAudioOnly?.();");
                        }
                    }
                    "toggle_close_to_tray" => {
                        let state = app_handle.state::<AppState>();
                        let current = state.minimize_on_close.load(Ordering::Relaxed);
                        let new_val = !current;
                        state.minimize_on_close.store(new_val, Ordering::Relaxed);
                        if let Ok(mut settings) = state.settings.lock() {
                            settings.minimize_to_tray_on_close = new_val;
                            settings.save(app_handle);
                        }
                        let _ = close_item_clone.set_checked(new_val);
                    }
                    "quit" => {
                        if let Some(wv) = app_handle.get_webview_window("main") {
                            let _ = wv.eval("try { localStorage.setItem('zumic_saved_volume', String(window.zumic?.getVolume?.() ?? 100)); } catch (_) {}");
                        }
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                                let _ = window.eval("window.zumic?.setAutoPowerSaver?.(true);");
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.eval("window.zumic?.setAutoPowerSaver?.(false);");
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                if let Some(wv) = app.get_webview_window("main") {
                    let _ = wv.eval("try { localStorage.setItem('zumic_saved_volume', String(window.zumic?.getVolume?.() ?? 100)); } catch (_) {}");
                }
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
