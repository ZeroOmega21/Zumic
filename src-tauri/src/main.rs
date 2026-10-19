// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discord;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use discord::DiscordRpc;

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

/// Estado global compartido para el cliente de Discord RPC
pub struct AppState {
    pub discord: Mutex<DiscordRpc>,
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
        })
        .invoke_handler(tauri::generate_handler![update_presence, clear_presence])
        .setup(|app| {
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
                .item(&quit_item)
                .build()?;

            let tray_icon = app.default_window_icon().cloned().expect("Icono por defecto no encontrado");

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Zumic — YouTube Music")
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
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
                    "quit" => {
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
                // Al presionar la X, ocultar y activar automáticamente ahorro de energía
                api.prevent_close();
                let _ = window.hide();
                if let Some(wv) = window.app_handle().get_webview_window("main") {
                    let _ = wv.eval("window.zumic?.setAutoPowerSaver?.(true);");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Error al iniciar la aplicación Zumic");
}
