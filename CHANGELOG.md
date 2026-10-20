# Registro de Cambios (Changelog) - Zumic 🎵

Todos los cambios notables en este proyecto se documentarán en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-10-20

### 🐛 Corrección de Errores y Mejoras de Interfaz (Bug Fixes & UI Improvements)
- **Inicio de Sesión de Google Fluido (Sin Congelamiento):**
  - Se añadieron todos los dominios y dominios regionales (ccTLD) de Google (`google.*`, `*.google.*`, `googleusercontent.com`, `1e100.net`, etc.) y esquemas `about:blank` a la lista permitida de `on_navigation` en WebView2. Esto evita que la cadena final de redirección de cookies de sesión (`CheckCookie` / `SetSID`) sea bloqueada o abierta en un navegador externo.
  - Redirección automática a `https://music.youtube.com` si tras completar el inicio de sesión la ventana aterriza en `www.youtube.com` o `myaccount.google.com`.
  - Se restringió `init.js` para que solo se ejecute en `music.youtube.com`, protegiendo las páginas de inicio de sesión de Google.
- **Corrección de Miniatura con Zoom y Proporciones 16:9:**
  - Se eliminó el parámetro de recorte de servidor `?sqp=...` en las URLs de `i.ytimg.com` que causaba un doble recorte (zoom involuntario de 1.33x) al convertir de 16:9 a 4:3 y luego a 16:9 en el contenedor. Ahora las miniaturas se muestran completas y fieles al encuadre original.
  - Fallback automático con `failedThumbUrls` para miniaturas de video antiguas que no posean versión `sddefault.jpg`, degradando suavemente a `hqdefault.jpg`.
- **Transición Homogénea al Abrir y Cerrar la Canción:**
  - Al abrir la vista de reproducción, la pantalla de inicio (`#browse-page`, `#search-page`, `ytmusic-browse-response`) se oculta de inmediato para que no se trasluzca a través del fondo translúcido durante la animación de subida.
  - Se neutralizó el `transform` inline del miniplayer en `ytmusic-player` para que la carátula, el selector `[ Canción | Video ]` y la cola suban de forma bloqueada y homogénea como un único panel.
- **Sincronización Exacta entre Canciones y Videos en Listas/Mixes:**
  - Se implementó `getActiveQueueItemImgSrc()` para consultar únicamente el ítem en reproducción activa de la cola (`play-button-state="playing"` o `selected`), evitando que canciones anteriores en pausa hereden su carátula a videos posteriores.
  - Detección inmediata de miniaturas de video en la barra inferior para transicionar instantáneamente a formato 16:9 sin mostrar carátulas residuales.
- **Mejoras en Modo Pantalla Completa (`player-fullscreened`):**
  - Centrado perfecto de videos y miniaturas en pantalla completa de borde a borde (eliminando el margen lateral de 72px de la barra de navegación).
  - Formato cuadrado 1:1 (`min(78vh, 78vw)`) sin zoom exclusivamente para carátulas de canciones con diseño centrado y sombras sobre el fondo difuminado.
  - Ocultamiento automático de la lista de reproducción (`#side-panel`) en pantalla completa para evitar superposiciones de texto.
  - Corrección de la barra de reproducción inferior (`ytmusic-player-bar`) para que conserve interactividad completa (pausa, cambio de pista, barra de progreso) en pantalla completa.
- **Estabilidad en Menús de Ajustes y Perfil de Usuario:**
  - Se corrigió el cierre espontáneo del menú de perfil (`tp-yt-iron-dropdown` / "Administra tu Cuenta de Google") provocado por clics automáticos repetitivos de sincronización A/V en pistas de video puras.
  - Prevención de disparos sintéticos cuando hay menús o diálogos abiertos (`isAnyPopupMenuOpen()`).
- **Adaptabilidad en Resoluciones Intermedias y Modo Móvil/4:3 (`is-mweb-modernization-enabled`):**
  - Dimensiones adaptativas para carátulas cuadradas 1:1 y videos 16:9 en modo compacto, evitando que el reproductor colapse a 0px de alto.
  - Corrección de la posición de la barra superior `[ v | Canción / Video | ⋮ ]` en modo compacto para que permanezca en su ubicación superior nativa.

---

## [0.3.1] - 2026-10-20

### 🐛 Corrección de Errores (Bug Fixes)
- **Activación de Discord Rich Presence en Instaladores de Producción (`.exe` / `.msi`):**
  - Se corrigió el bloqueo silencioso de llamadas IPC (`update_presence` y `clear_presence`) que ocurría en versiones empaquetadas de producción al navegar en `https://music.youtube.com`. En Tauri v2, las URLs remotas bajo `custom-protocol` requieren permisos explícitos en el sistema de ACL.
  - Se declararon los comandos de la aplicación en `AppManifest` (`build.rs`) y se habilitaron las capacidades remotas para los dominios de YouTube Music en `capabilities/default.json`.
  - Se inyectó `init.js` mediante `initialization_script` en el WebView para garantizar disponibilidad temprana del bridge IPC.
  - Se añadió saneamiento automático de longitud en cadenas de texto enviadas a Discord RPC (mínimo 2 caracteres, máximo 120 caracteres) y límite seguro de longitud en URLs de carátulas para evitar rechazos por parte del socket de Discord.
  - Se redujo el tiempo de reintento de conexión a Discord de 30s a 5s con reconexión inmediata si Discord se reinicia.

---

## [0.3.0] - 2026-10-19

### ✨ Novedades y Características
- **Fondo Difuminado Dinámico de Carátula (*Ambient Glow*):**
  - Fondo ambiental suave que proyecta los tonos de la carátula o miniatura en alta resolución con desenfoque gaussiano acelerado por hardware (`filter: blur(65px)`).
  - **Cero consumo adicional continuo:** Al renderizarse como textura de imagen estática (y no como video animado en tiempo real), no sobrecarga la GPU ni calienta los ventiladores durante la reproducción.
  - **Degradado Suave en Página Principal:** Transición progresiva multicapa que elimina los cortes bruscos de color y líneas rígidas de los contenedores de YouTube Music, fundiéndose suavemente hacia el negro profundo.
  - **Desconexión Total en Modo Ahorro:** Al activar el Modo Ahorro o minimizar a la bandeja, el fondo difuminado se apaga por completo (`display: none;`), garantizando el mínimo consumo de energía y GPU posible.
- **Control de Volumen con la Rueda del Ratón (Inspirado en Glassy Music):**
  - Ajuste fluido del porcentaje de volumen (de 0% a 100%) al girar la rueda del ratón directamente sobre la carátula o el reproductor de video.
  - Indicador flotante en tiempo real con números grandes en la esquina superior izquierda de la carátula (`14%`, `50%`, etc.) que aparece al girar y se desvanece suavemente tras 1.3 segundos de inactividad.
  - Sincronización instantánea con el reproductor interno de YouTube Music, el elemento de audio/video y el control deslizante de volumen de la barra inferior.
  - **Memoria de Volumen al Cerrar:** Al cerrar la aplicación (ya sea con la `X` o desde el menú de la bandeja) o cambiar de pista, se guarda automáticamente el nivel de volumen exacto y se restaura fielmente en el siguiente inicio.
- **Ajuste Persistente para Cerrar con la 'X':**
  - Nueva opción en el menú contextual de la bandeja del sistema: `☑ Minimizar a la bandeja al presionar (X)`.
  - Los usuarios que prefieran que la aplicación se cierre por completo al hacer clic en la `X` pueden desmarcar esta opción y Zumic se cerrará de inmediato sin quedar en segundo plano.
  - La preferencia se guarda de manera persistente en `settings.json`.
- **Refuerzo de Seguridad en Navegación Externa (*Navigation Lockdown*):**
  - Bloqueo de URLs ajenas a YouTube y Google dentro de la ventana de WebView2 mediante el hook `on_navigation`.
  - Cualquier enlace externo (por ejemplo, links de artistas en descripciones a redes sociales, Spotify o webs de terceros) se abre de forma segura en el navegador predeterminado del sistema (Brave, Chrome, Edge, etc.) sin exponer la aplicación.
- **Hitbox Ampliada en Barra de Progreso de Tiempo:**
  - Se amplió la zona de detección e interacción del ratón en la barra de tiempo a 24px de alto (antes era de apenas 2-4px), permitiendo adelantar o retroceder la canción de forma inmediata y precisa sin tener que apuntar milimétricamente.
  - Al pasar el ratón cerca de la barra, esta se engrosa suavemente de 3px a 6px ofreciendo feedback visual claro.
- **Limpieza de Interfaz:**
  - Ocultamiento permanente del botón de transmitir (*Chromecast / Cast*) de la barra inferior de reproducción para una barra más despejada y limpia.
- **Infraestructura de Compilación y Distribución Automática:**
  - Flujo de integración continua configurado en `.github/workflows/release.yml` para compilar automáticamente instaladores `.exe` (NSIS) y `.msi` en la nube de GitHub Actions en cada versión, permitiendo a los usuarios descargar e instalar Zumic sin necesidad de tener un IDE instalado.

### 🐛 Corrección de Errores (Bug Fixes)
- **Eliminación de Carátula / Video Duplicado (48x48) en Vista Estrecha:**
  - Se corrigió el problema donde, al minimizar la página del reproductor y navegar por *Principal* en dimensiones compactas (`500px`), quedaba flotando un duplicado de `48x48` de la carátula o del video debido a que `visibility: visible` sobreescribía el `visibility: hidden` del contenedor padre en estado `PLAYER_BAR_ONLY`.
- **Sincronización Exacta de Miniaturas en Videos sin Carátula de Álbum:**
  - Se solucionó un fallo ocasional donde, al pasar de una canción con carátula cuadrada a un video sin carátula de álbum estando en modo **Canción**, quedaba retenida la carátula cuadrada de la canción anterior en lugar de cargar la miniatura panorámica (`16:9`) del video actual.
  - Se añadió verificación estricta de `videoId` en caché y detección inmediata de videos puros (`!canSwitch`) para evitar heredar imágenes residuales del DOM durante las transiciones.

---

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
