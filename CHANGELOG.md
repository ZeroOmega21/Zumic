# Registro de Cambios (Changelog) - Zumic 🎵

Todos los cambios notables en este proyecto se documentarán en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-19

### ✨ Novedades y Características
- **Modo Compacto Responsivo (9:16 / Modo Esquina):**
  - Soporte para redimensionar la ventana en relación de aspecto vertical tipo teléfono (`9:16`), ideal para dejar Zumic anclado en una esquina de la pantalla mientras se juega o trabaja.
  - Límite de ancho mínimo fijado en `500px` (y `600px` de alto) coincidiendo con el límite nativo de Brave Browser para evitar deformaciones en la interfaz de YouTube Music.
  - Preservación del diseño móvil nativo de YouTube Music en ventanas estrechas: se mantienen visibles la flecha de repliegue (`v`), la carátula centralizada, el título y artista de la pista, la barra de progreso, el botón central de reproducción y las pestañas inferiores (*A continuación | Letra | Similares*).
  - Integración de la píldora `[ Canción | Video ]` directamente en el contenedor nativo superior (`#av-id`), alineada entre la flecha de repliegue y el menú contextual.
- **Atajos Globales con Teclas Libres:**
  - Control de reproducción con teclas de función dedicadas sin combinaciones ni modificadores para evitar interferencias con videojuegos y otras aplicaciones:
    - `F8`: Reproducir / Pausar
    - `F9`: Siguiente canción
    - `F7`: Canción anterior
  - Compatibilidad total con teclas multimedia nativas del teclado (`MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious`, `MediaStop`).

### 🐛 Corrección de Errores (Bug Fixes)
- **Restauración de Carátulas (Video a Canción):**
  - Se corrigió el error por el cual, al regresar de modo Video a modo Canción en pistas con carátula oficial de álbum, quedaba fijada la miniatura de fotograma de video (16:9).
  - Priorización inteligente de carátulas cuadradas en alta resolución (`lh3.googleusercontent.com` / `ggpht.com`).
  - Soporte de restauración de carátulas para sesiones restauradas en frío antes de pulsar Reproducir (`NaN:NaN`).

### ⚡ Rendimiento y Estabilidad
- **Discord RPC Asíncrono:**
  - Comunicación con Discord Rich Presence migrada a tareas asíncronas no bloqueantes en Rust con enfriamiento de reconexión de 30 segundos, eliminando pausas o caídas de fluidez al cambiar de canción.
- **Inyección Única de Scripts:**
  - Prevención de inyecciones duplicadas en sub-iframes de YouTube Music mediante escucha exclusiva de `PageLoadEvent::Finished` en el marco principal.
- **Caché de Metadatos:**
  - Almacenamiento en caché de la respuesta del reproductor (`getPlayerResponse()`) por ID de video, reduciendo el consumo de CPU y accesos innecesarios al DOM.

---

## [0.1.0] - 2026-10-19

### ✨ Versión Inicial
- Cliente de escritorio ultraligero para YouTube Music desarrollado con **Tauri v2** y **Rust**.
- Selector nativo interactivo `[ Canción | Video ]` para alternar entre carátula de álbum y videoclip.
- Integración completa con **Discord Rich Presence** (título, artista, álbum, carátula en alta resolución, tiempo transcurrido y botón *"Escuchar en YouTube"*).
- Modo Ahorro (Solo Audio) para reducir el uso de GPU y batería.
- Bloqueo y salto rápido de publicidad y descarte automático de diálogos "¿Sigues ahí?".
- Icono en la bandeja del sistema (System Tray) con menú contextual.
