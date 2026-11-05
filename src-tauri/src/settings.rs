//! Módulo de configuración persistente de usuario (`settings.json`)

use tauri::Manager;

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
    /// Carga los ajustes desde el archivo `settings.json` en el directorio de configuración,
    /// o devuelve los valores por defecto si no existe o falla la lectura.
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

    /// Guarda los ajustes actuales en `settings.json` dentro del directorio de configuración.
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
