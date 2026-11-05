//! Atajos globales multimedia y snippets JS de control de reproducción

use tauri::{plugin::TauriPlugin, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

/// Snippets JS robustos para control de reproducción garantizado
pub const JS_TOGGLE_PLAY: &str = r#"
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

pub const JS_NEXT_TRACK: &str = r#"
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

pub const JS_PREV_TRACK: &str = r#"
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

pub const JS_STOP_TRACK: &str =
    "const p = document.querySelector('#movie_player'); if (p && p.pauseVideo) p.pauseVideo();";

/// Construye y configura el plugin de atajos globales multimedia (MediaKeys + F7/F8/F9)
pub fn build_shortcut_plugin<R: Runtime>() -> TauriPlugin<R> {
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
            if event.state != ShortcutState::Pressed {
                return;
            }

            let Some(window) = app.get_webview_window("main") else {
                return;
            };

            if shortcut.matches(Modifiers::empty(), Code::MediaPlayPause)
                || shortcut.matches(Modifiers::empty(), Code::F8)
            {
                let _ = window.eval(JS_TOGGLE_PLAY);
            } else if shortcut.matches(Modifiers::empty(), Code::MediaTrackNext)
                || shortcut.matches(Modifiers::empty(), Code::F9)
            {
                let _ = window.eval(JS_NEXT_TRACK);
            } else if shortcut.matches(Modifiers::empty(), Code::MediaTrackPrevious)
                || shortcut.matches(Modifiers::empty(), Code::F7)
            {
                let _ = window.eval(JS_PREV_TRACK);
            } else if shortcut.matches(Modifiers::empty(), Code::MediaStop) {
                let _ = window.eval(JS_STOP_TRACK);
            }
        })
        .build()
}
