//! Módulo de integración con Discord Rich Presence
//!
//! Gestiona la conexión IPC con el cliente de Discord local, incluyendo
//! reconexión automática cuando Discord se cierra o reinicia.

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::TrackMetadata;

/// Discord Application Client ID — reemplaza con tu propio ID desde
/// https://discord.com/developers/applications
const DISCORD_CLIENT_ID: &str = "1560778602507796490";

/// Enfriamiento entre intentos de reconexión cuando Discord está cerrado
const RECONNECT_COOLDOWN: Duration = Duration::from_secs(5);

/// Garantiza que los textos enviados a Discord RPC cumplan la longitud válida (2..=120 caracteres)
fn sanitize_discord_str(input: &str, fallback: &str) -> String {
    let trimmed = input.trim();
    let base = if trimmed.is_empty() { fallback } else { trimmed };
    let char_count = base.chars().count();
    if char_count < 2 {
        format!("{} ", base)
    } else if char_count > 120 {
        let truncated: String = base.chars().take(119).collect();
        format!("{}…", truncated)
    } else {
        base.to_string()
    }
}

/// Wrapper seguro alrededor del cliente IPC de Discord
pub struct DiscordRpc {
    client: Option<DiscordIpcClient>,
    last_connect_attempt: Option<Instant>,
}

impl DiscordRpc {
    /// Crea un nuevo cliente Discord RPC sin bloquear el arranque de la ventana.
    /// Conectará de forma perezosa en el primer update.
    pub fn new() -> Self {
        DiscordRpc {
            client: None,
            last_connect_attempt: None,
        }
    }

    /// Intenta establecer conexión IPC con Discord respetando un cooldown
    /// para no saturar pipes del sistema si Discord está cerrado.
    fn try_connect(&mut self) {
        if let Some(last) = self.last_connect_attempt {
            if last.elapsed() < RECONNECT_COOLDOWN {
                return;
            }
        }
        self.last_connect_attempt = Some(Instant::now());

        match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
            Ok(mut client) => match client.connect() {
                Ok(_) => {
                    log::info!("Discord RPC conectado correctamente");
                    self.client = Some(client);
                }
                Err(e) => {
                    log::warn!("No se pudo conectar con Discord RPC: {}", e);
                    self.client = None;
                }
            },
            Err(e) => {
                log::warn!("No se pudo crear el cliente Discord RPC: {}", e);
                self.client = None;
            }
        }
    }

    /// Actualiza el Rich Presence con los metadatos de la pista actual.
    /// Reconecta automáticamente si la conexión se perdió.
    pub fn update(&mut self, metadata: &TrackMetadata) -> Result<(), String> {
        // Asegurar conexión activa
        if self.client.is_none() {
            self.try_connect();
        }

        // Pre-computar todos los Strings owned ANTES de tomar el borrow de client
        // (fix E0716: temporary dropped while borrowed)
        let large_image: String =
            if metadata.artwork_url.is_empty() || metadata.artwork_url.len() > 256 {
                "zumic_logo".to_string()
            } else {
                metadata.artwork_url.clone()
            };

        let details_str = sanitize_discord_str(&metadata.title, "YouTube Music");

        let large_text_str = if !metadata.album.trim().is_empty() {
            sanitize_discord_str(&metadata.album, "Zumic")
        } else {
            details_str.clone()
        };

        let raw_base_state = if !metadata.album.trim().is_empty() {
            format!("{} — {}", metadata.artist, metadata.album)
        } else {
            metadata.artist.clone()
        };
        let base_state = sanitize_discord_str(&raw_base_state, "Artista desconocido");

        let has_valid_track_url = !metadata.track_url.is_empty()
            && metadata.track_url.starts_with("https://")
            && metadata.track_url.len() <= 512;

        if !metadata.is_playing {
            // --- Pausa ---
            let state_str = sanitize_discord_str(&format!("⏸ {}", base_state), "⏸ En pausa");

            let client = match &mut self.client {
                Some(c) => c,
                None => return Ok(()), // Discord no disponible
            };

            let mut activity = Activity::new()
                .activity_type(ActivityType::Listening)
                .details(&details_str)
                .state(&state_str)
                .assets(
                    Assets::new()
                        .large_image(&large_image)
                        .large_text(&large_text_str)
                        .small_image("pause_icon")
                        .small_text("En pausa"),
                );

            if has_valid_track_url {
                activity = activity.buttons(vec![Button::new(
                    "Escuchar en YouTube",
                    metadata.track_url.as_str(),
                )]);
            }

            // Separar el call de set_activity del manejo de error
            // para evitar que el closure tome &mut self mientras client está borrowed
            let result = client.set_activity(activity);
            if let Err(e) = result {
                log::warn!("Error al actualizar presencia Discord (pausa): {}", e);
                self.client = None;
                self.last_connect_attempt = None;
                return Err(e.to_string());
            }
            Ok(())
        } else {
            // --- Reproduciendo ---
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let start = now - metadata.current_time_secs as i64;
            let end = if metadata.duration_secs > 0.0 {
                start + metadata.duration_secs as i64
            } else {
                0
            };

            let timestamps = if end > 0 {
                Timestamps::new().start(start).end(end)
            } else {
                Timestamps::new().start(start)
            };

            let client = match &mut self.client {
                Some(c) => c,
                None => return Ok(()),
            };

            let mut activity = Activity::new()
                .activity_type(ActivityType::Listening)
                .details(&details_str)
                .state(&base_state)
                .assets(
                    Assets::new()
                        .large_image(&large_image)
                        .large_text(&large_text_str)
                        .small_image("play_icon")
                        .small_text("Reproduciendo"),
                )
                .timestamps(timestamps);

            if has_valid_track_url {
                activity = activity.buttons(vec![Button::new(
                    "Escuchar en YouTube",
                    metadata.track_url.as_str(),
                )]);
            }

            let result = client.set_activity(activity);
            if let Err(e) = result {
                log::warn!("Error al actualizar presencia Discord (play): {}", e);
                self.client = None;
                self.last_connect_attempt = None;
                return Err(e.to_string());
            }
            Ok(())
        }
    }

    /// Limpia completamente el Rich Presence de Discord.
    pub fn clear(&mut self) -> Result<(), String> {
        let client = match &mut self.client {
            Some(c) => c,
            None => return Ok(()),
        };
        let result = client.clear_activity();
        if let Err(e) = result {
            self.client = None;
            return Err(e.to_string());
        }
        Ok(())
    }
}

impl Drop for DiscordRpc {
    fn drop(&mut self) {
        if let Some(client) = &mut self.client {
            let _ = client.clear_activity();
            let _ = client.close();
        }
    }
}
