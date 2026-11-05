//! Comandos IPC expuestos al frontend (WebView) y estado global compartido

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;

use crate::discord::DiscordRpc;
use crate::settings::AppSettings;

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

impl AppState {
    pub fn new(discord: DiscordRpc) -> Self {
        Self {
            discord: Mutex::new(discord),
            settings: Mutex::new(AppSettings::default()),
            minimize_on_close: AtomicBool::new(true),
        }
    }
}

/// Comando Tauri asíncrono: actualiza el Rich Presence en un hilo secundario sin bloquear la UI
#[tauri::command]
pub async fn update_presence(
    metadata: TrackMetadata,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut discord = state.discord.lock().map_err(|e| e.to_string())?;
    discord.update(&metadata).map_err(|e| e.to_string())
}

/// Comando Tauri asíncrono: limpia el Rich Presence sin bloquear la UI
#[tauri::command]
pub async fn clear_presence(state: State<'_, AppState>) -> Result<(), String> {
    let mut discord = state.discord.lock().map_err(|e| e.to_string())?;
    discord.clear().map_err(|e| e.to_string())
}

/// Comando Tauri: obtiene los ajustes actuales
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

/// Comando Tauri: actualiza la preferencia de minimizar a la bandeja al presionar X
#[tauri::command]
pub fn set_minimize_to_tray(
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
