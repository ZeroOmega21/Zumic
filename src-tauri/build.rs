fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "update_presence",
                "clear_presence",
                "get_settings",
                "set_minimize_to_tray",
            ]),
        ),
    )
    .expect("Error al ejecutar tauri-build");
}
