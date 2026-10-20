# Zumic 🎵

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Zumic Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Cliente de escritorio moderno, ultraligero y rápido para YouTube Music</strong><br>
  Construido con Tauri v2 y Rust para ofrecer el mínimo consumo de recursos y máxima fluidez.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3.0-blue?style=flat-square" alt="Version 0.3.0">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?style=flat-square&logo=tauri" alt="Tauri v2">
  <img src="https://img.shields.io/badge/Rust-2021-orange?style=flat-square&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/Discord-Rich%20Presence-5865F2?style=flat-square&logo=discord" alt="Discord Rich Presence">
</p>

---

## ✨ Características

- ⚡ **Ultraligero y Eficiente:** Desarrollado con **Tauri v2** y **Rust**, consumiendo una fracción diminuta de memoria RAM y CPU en comparación con alternativas basadas en Electron.
- 🎛️ **Selector Inteligente [ Canción | Video ]:**
  - Alterna dinámicamente entre la carátula oficial del álbum (**Canción**) y el videoclip musical (**Video**).
  - Detección inteligente de pistas: deshabilita el botón de Video automáticamente en canciones que no tienen video disponible.
  - Para videos sin versión de álbum, mantiene la miniatura panorámica en alta resolución en lugar de dejar el reproductor vacío.
  - Carátula perfectamente centrada con proporciones equilibradas similares a la versión web de escritorio.
- 🎮 **Discord Rich Presence en Tiempo Real:**
  - Muestra tu estado musical en Discord con el título de la canción, artista y álbum.
  - Carátulas en alta resolución (`1200x1200`) y barra de progreso sincronizada al segundo.
  - Botón interactivo *"Escuchar en YouTube"* para que tus amigos abran la misma canción.
  - Conexión asíncrona sin bloqueos ni retrasos en la interfaz.
- 🍃 **Modo Ahorro (Solo Audio):**
  - Actívalo con un clic desde el botón `⚡ Ahorro` en la barra de navegación o desde la bandeja del sistema.
  - Suspende el renderizado del video para ahorrar batería y uso de GPU mientras juegas o trabajas.
- ⌨️ **Atajos Globales de Teclado:**
  - Teclas multimedia nativas: `Play/Pause`, `Siguiente`, `Anterior`, `Stop`.
  - **Teclas de función libres dedicadas:**
    - `F8`: Reproducir / Pausar
    - `F9`: Siguiente canción
    - `F7`: Canción anterior
    - *Sin combinaciones con Ctrl/Alt/Shift para no interferir con controles en videojuegos.*
- 📱 **Diseño Responsivo y Modo Esquina (9:16):**
  - Permite estrechar la ventana en formato vertical 9:16 (ancho mínimo de 500px) ideal para ubicar Zumic en una esquina mientras trabajas o juegas.
  - Adopta automáticamente el reproductor móvil nativo de YouTube Music sin perder controles, botones ni carátulas.
- 🌌 **Fondo Difuminado Dinámico (Ambient Glow):**
  - Proyecta los colores de la carátula o miniatura en un fondo ambiental suave con aceleración por hardware.
  - **Cero consumo adicional continuo:** Al ser una textura estática optimizada, no consume GPU de forma continua.
  - **Desconexión Total en Modo Ahorro:** Al activar el Modo Ahorro, el fondo difuminado se apaga por completo (`display: none;`).
- 🔊 **Control de Volumen con la Rueda del Ratón y Memoria:**
  - Ajusta el volumen porcentual girando la rueda del ratón directamente sobre la carátula o el reproductor de video.
  - Muestra un elegante indicador numérico flotante en la esquina superior izquierda de la carátula que se desvanece suavemente.
  - **Recuerda el volumen:** Guarda automáticamente el nivel de volumen al cerrar la aplicación o cambiar de canción y lo restaura al volver a abrir Zumic.
- 📥 **Bandeja del Sistema (Tray Icon) y Ajuste de Cierre:**
  - Controla la reproducción directamente desde el menú contextual en la bandeja de Windows.
  - Opción conmutable `☑ Minimizar a la bandeja al presionar (X)`: si la desmarcas, la aplicación se cierra de inmediato sin quedar en segundo plano.
- 🛡️ **Experiencia Limpia y Navegación Segura:**
  - Salto y silenciamiento rápido de anuncios de video y descarte automático de diálogos "¿Sigues ahí?".
  - Botón de transmitir (*Cast / Chromecast*) retirado para una barra de reproducción más limpia.
  - **Bloqueo de navegación externa:** Cualquier enlace hacia redes sociales o webs de terceros se abre en el navegador predeterminado del sistema, protegiendo tu sesión y la app.
- 📦 **Instalador Autónomo (.exe / .msi):**
  - No requiere ningún IDE ni herramientas de desarrollo. Doble clic para instalar y listo.

---

## ⌨️ Atajos de Teclado

| Tecla | Acción |
| :--- | :--- |
| `F8` / `MediaPlayPause` | Reproducir / Pausar |
| `F9` / `MediaTrackNext` | Siguiente canción |
| `F7` / `MediaTrackPrevious` | Canción anterior |
| `MediaStop` | Detener reproducción |

---

## 🚀 Requisitos Previos

1. **[Rust](https://rustup.rs/):** Versión estable (edición 2021).
2. **[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/):** Necesario para compilar en Windows.
3. **[Tauri CLI v2](https://tauri.app/start/):**
   ```powershell
   cargo install tauri-cli --version "^2"
   ```

---

## 🛠️ Instalación y Desarrollo

1. **Clonar el repositorio:**
   ```powershell
   git clone https://github.com/ZeroOmega21/Zumic.git
   cd Zumic
   ```

2. **Ejecutar en modo de desarrollo:**
   ```powershell
   cargo tauri dev
   ```

3. **Compilar instalador y binario optimizado para producción:**
   ```powershell
   cargo tauri build
   ```
   El ejecutable final se generará en `src-tauri/target/release/zumic.exe` y los instaladores en `src-tauri/target/release/bundle/`.

---

## 🎮 Configuración de Discord Rich Presence

Zumic incluye por defecto una aplicación de Discord configurada para mostrar el Rich Presence. Si deseas utilizar tu propia aplicación de Discord:

1. Ve al [Discord Developer Portal](https://discord.com/developers/applications).
2. Crea una nueva aplicación (por ejemplo, con el nombre **Zumic**).
3. Copia el **Application ID**.
4. Edita el archivo `src-tauri/src/discord.rs` y cambia la constante:
   ```rust
   const DISCORD_CLIENT_ID: &str = "TU_APPLICATION_ID_AQUI";
   ```
5. En la sección **Rich Presence > Art Assets** de tu aplicación en Discord, puedes subir:
   - `zumic_logo`: Icono grande por defecto si una pista no tiene carátula.
   - `play_icon`: Icono pequeño para el estado de reproducción.
   - `pause_icon`: Icono pequeño para el estado en pausa.

---

## 📂 Estructura del Proyecto

```
Zumic/
├── scripts/
│   └── init.js              # Script inyectado: observadores, selector Canción/Video, atajos y presencia
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Entrada principal, atajos globales y ventana WebView2
│   │   └── discord.rs       # Cliente asíncrono Discord RPC
│   ├── icons/               # Iconos de la aplicación
│   ├── capabilities/        # Permisos de Tauri v2
│   ├── Cargo.toml           # Dependencias de Rust
│   └── tauri.conf.json      # Configuración de Tauri v2
├── CHANGELOG.md             # Historial de cambios y versiones
└── README.md                # Documentación del proyecto
```

---

## 📜 Historial de Versiones

Para consultar la lista completa de cambios y novedades de cada versión, revisa el archivo [CHANGELOG.md](CHANGELOG.md).

---

## 🙏 Agradecimientos e Inspiración

Este proyecto fue inspirado en la estética, diseño y experiencia de usuario de [Glassy Music](https://github.com/aAndrew-me/Glassy-Music), tomando como referencia características como el fondo difuminado ambiental y el control intuitivo de volumen con la rueda del ratón sobre la carátula.

---

## 📄 Licencia

Este proyecto está distribuido bajo la licencia MIT. Consulta el archivo `LICENSE` para más información.
