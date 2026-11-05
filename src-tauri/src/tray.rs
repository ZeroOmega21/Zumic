//! Configuración y eventos del icono en la bandeja del sistema (System Tray)

use std::sync::atomic::Ordering;
use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

use crate::commands::AppState;
use crate::shortcuts::{JS_NEXT_TRACK, JS_PREV_TRACK, JS_TOGGLE_PLAY};

/// Alterna la visibilidad de la ventana principal y ajusta el ahorro automático de energía
pub fn toggle_main_window(app: &AppHandle) {
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

/// Persiste el volumen actual en el `localStorage` de la WebView antes de ocultar o cerrar
pub fn save_volume_in_webview(app: &AppHandle) {
    if let Some(wv) = app.get_webview_window("main") {
        let _ = wv.eval(
            "try { localStorage.setItem('zumic_saved_volume', String(window.zumic?.getVolume?.() ?? 100)); } catch (_) {}",
        );
    }
}

/// Construye e inicializa el menú e icono de la bandeja del sistema
pub fn setup_tray(app: &App, initial_minimize_to_tray: bool) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Mostrar / Ocultar", true, None::<&str>)?;
    let play_pause_item =
        MenuItem::with_id(app, "play_pause", "Reproducir / Pausar", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "Siguiente canción", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "prev", "Canción anterior", true, None::<&str>)?;
    let saver_item = MenuItem::with_id(
        app,
        "toggle_saver",
        "Modo Ahorro (Solo Audio): Alternar",
        true,
        None::<&str>,
    )?;
    let close_to_tray_item = CheckMenuItem::with_id(
        app,
        "toggle_close_to_tray",
        "Minimizar a la bandeja al presionar (X)",
        true,
        initial_minimize_to_tray,
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

    let tray_icon = app
        .default_window_icon()
        .cloned()
        .expect("Icono por defecto no encontrado");
    let close_item_clone = close_to_tray_item.clone();

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Zumic — YouTube Music")
        .on_menu_event(move |app_handle, event| match event.id.as_ref() {
            "show" => {
                toggle_main_window(app_handle);
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
                save_volume_in_webview(app_handle);
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
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
