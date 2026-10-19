/**
 * Zumic — Script de inicialización inyectado en la WebView
 *
 * Responsabilidades:
 *  1. Observar cambios en el reproductor de YouTube Music
 *  2. Extraer metadatos de mediaSession y el DOM
 *  3. Enviar metadatos al backend Rust via Tauri IPC
 *  4. Inyectar estilos visuales personalizados (blur/transparencia)
 */

(function ZumicInit() {
  // No ejecutar nunca dentro de iframes secundarios de YouTube
  if (window !== window.top) return;

  if (window.__ZUMIC_INITIALIZED__) {
    return;
  }
  window.__ZUMIC_INITIALIZED__ = true;

  // ─── Configuración ────────────────────────────────────────────────────────
  const CONFIG = {
    // Intervalo de polling para progreso (ms)
    PROGRESS_INTERVAL_MS: 3000,
    // Colores y blur del tema (solo se activa si el usuario configura BACKGROUND_IMAGE)
    BACKGROUND_IMAGE: '',
    BLUR_AMOUNT: '20px',
    BACKGROUND_OPACITY: 0.3,
    // Log de debug en consola
    DEBUG: false,
  };

  // ─── Utilidades ───────────────────────────────────────────────────────────
  const log = (...args) => CONFIG.DEBUG && console.log('[Zumic]', ...args);

  // ─── Estado local ─────────────────────────────────────────────────────────
  let lastMetadata = null;
  let progressInterval = null;
  let syncDebounceTimer = null;

  // ─── Invocador Tauri IPC ──────────────────────────────────────────────────
  async function invokeUpdatePresence(metadata) {
    try {
      // Tauri v2: window.__TAURI__.core.invoke
      if (window.__TAURI__ && window.__TAURI__.core) {
        await window.__TAURI__.core.invoke('update_presence', { metadata });
        log('Presencia actualizada:', metadata.title);
      }
    } catch (err) {
      console.warn('[Zumic] Error al invocar update_presence:', err);
    }
  }

  async function invokeClearPresence() {
    try {
      if (window.__TAURI__ && window.__TAURI__.core) {
        await window.__TAURI__.core.invoke('clear_presence');
        log('Presencia limpiada');
      }
    } catch (err) {
      console.warn('[Zumic] Error al invocar clear_presence:', err);
    }
  }

  // ─── Extracción de metadatos ──────────────────────────────────────────────

  /** Obtiene la URL del artwork desde el player bar, mediaSession o el DOM */
  function getArtworkUrl() {
    // 1. Si el player bar tiene una carátula de álbum (googleusercontent), preferirla
    const barImg = document.querySelector(
      'ytmusic-player-bar .thumbnail-image-wrapper img, ytmusic-player-bar yt-img-shadow.image img, ytmusic-player-bar img.image'
    );
    const barSrc = barImg?.getAttribute('src') || barImg?.src || '';
    if (barSrc && (barSrc.includes('googleusercontent.com') || barSrc.includes('ggpht.com'))) {
      return barSrc;
    }

    // 2. mediaSession metadata
    const ms = navigator.mediaSession;
    if (ms && ms.metadata && ms.metadata.artwork && ms.metadata.artwork.length > 0) {
      const artwork = ms.metadata.artwork;
      const sorted = [...artwork].sort((a, b) => {
        const sizeA = parseInt(a.sizes?.split('x')[0] || '0');
        const sizeB = parseInt(b.sizes?.split('x')[0] || '0');
        return sizeB - sizeA;
      });
      if (sorted[0]?.src) return sorted[0].src;
    }

    // 3. Fallback: cualquier imagen en el player bar o player page
    if (barSrc && !barSrc.startsWith('data:image')) return barSrc;
    const pageImg = document.querySelector(
      'ytmusic-player-page #song-image img, ytmusic-player-page #thumbnail img'
    );
    return pageImg?.src || '';
  }

  /** Obtiene el tiempo actual y duración del elemento <video> */
  function getVideoProgress() {
    const video = document.querySelector('video');
    if (!video) return { currentTime: 0, duration: 0 };
    return {
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
    };
  }

  /** Determina si el reproductor está en estado 'playing' */
  function getIsPlaying() {
    const video = document.querySelector('video');
    if (video) return !video.paused && !video.ended;
    // Fallback: mediaSession
    return navigator.mediaSession?.playbackState === 'playing';
  }

  /** Obtiene la URL limpia de la canción actual */
  function getTrackUrl() {
    // 1. Intentar desde el enlace del título en el player bar
    const titleLink = document.querySelector(
      'ytmusic-player-bar .title a, ytmusic-player-bar a[href*="watch?v="]'
    );
    if (titleLink && titleLink.href) {
      return titleLink.href;
    }
    // 2. Intentar desde el videoId del reproductor de YouTube
    try {
      const player = document.querySelector('#movie_player');
      const videoData = player?.getVideoData?.();
      if (videoData?.video_id) {
        return `https://music.youtube.com/watch?v=${videoData.video_id}`;
      }
    } catch (_) {}
    // 3. Fallback: URL del navegador si estamos en watch?v=
    if (window.location.href.includes('watch?v=')) {
      return window.location.href;
    }
    return 'https://music.youtube.com';
  }

  /** Extrae metadatos completos de la pista actual */
  function extractMetadata() {
    const ms = navigator.mediaSession;
    const msMeta = ms?.metadata;

    // Preferir mediaSession, fallback al DOM
    const title =
      msMeta?.title ||
      document.querySelector('ytmusic-player-bar .title')?.textContent?.trim() ||
      document.title.replace(' - YouTube Music', '').trim() ||
      'Sin título';

    const artist =
      msMeta?.artist ||
      document.querySelector('ytmusic-player-bar .byline a')?.textContent?.trim() ||
      'Artista desconocido';

    const album =
      msMeta?.album ||
      document.querySelector('ytmusic-player-bar .byline')?.textContent
        ?.replace(artist, '').replace(/[•·]/g, '').trim() ||
      '';

    const { currentTime, duration } = getVideoProgress();
    const artworkUrl = getArtworkUrl();
    const isPlaying = getIsPlaying();
    const trackUrl = getTrackUrl();

    return {
      title,
      artist,
      album,
      artwork_url: artworkUrl,
      is_playing: isPlaying,
      duration_secs: duration,
      current_time_secs: currentTime,
      track_url: trackUrl,
    };
  }

  /** Verifica si los metadatos cambiaron significativamente */
  function hasMetadataChanged(newMeta) {
    if (!lastMetadata) return true;
    return (
      lastMetadata.title !== newMeta.title ||
      lastMetadata.artist !== newMeta.artist ||
      lastMetadata.is_playing !== newMeta.is_playing ||
      lastMetadata.track_url !== newMeta.track_url
    );
  }

  /** Envía los metadatos al backend si cambiaron */
  function syncMetadata() {
    const player = document.querySelector('#movie_player');
    const isAd =
      player?.classList.contains('ad-showing') ||
      player?.classList.contains('ad-interrupting');
    if (isAd) {
      return;
    }

    const metadata = extractMetadata();
    if (hasMetadataChanged(metadata)) {
      lastMetadata = metadata;
      if (metadata.title === 'Sin título' || !metadata.title) {
        invokeClearPresence();
      } else {
        invokeUpdatePresence(metadata);
      }
    }
  }

  function scheduleSyncMetadata(delayMs = 250) {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      syncMetadata();
    }, delayMs);
  }

  // ─── Observadores ─────────────────────────────────────────────────────────

  /** Configura el listener de mediaSession para cambios de pista */
  function setupMediaSessionObserver() {
    const ms = navigator.mediaSession;
    if (!ms) return;

    let lastMsTitle = '';
    setInterval(() => {
      const title = ms.metadata?.title || '';
      if (title !== lastMsTitle) {
        lastMsTitle = title;
        log('mediaSession metadata cambió:', title);
        scheduleSyncMetadata(300);
      }
    }, 1000);
  }

  /** Observa el DOM de YouTube Music solo en el bloque de título/artista del player bar */
  function setupDomObserver() {
    const waitForPlayer = setInterval(() => {
      const contentInfo = document.querySelector('ytmusic-player-bar .content-info-wrapper');
      if (contentInfo) {
        clearInterval(waitForPlayer);
        const observer = new MutationObserver(() => {
          scheduleSyncMetadata(250);
        });
        observer.observe(contentInfo, { childList: true, subtree: true, characterData: true });
        log('MutationObserver conectado a .content-info-wrapper');
        scheduleSyncMetadata(200);
      }
    }, 1500);
  }

  /** Observa eventos del elemento <video> para play/pause/ended */
  function setupVideoObserver() {
    const attachVideoListeners = (video) => {
      video.addEventListener('play', () => scheduleSyncMetadata(150));
      video.addEventListener('pause', () => scheduleSyncMetadata(150));
      video.addEventListener('ended', () => invokeClearPresence());
      log('Listeners de video adjuntados');
    };

    const waitForVideo = setInterval(() => {
      const video = document.querySelector('video');
      if (video) {
        clearInterval(waitForVideo);
        attachVideoListeners(video);
      }
    }, 1500);
  }

  // ─── Bloqueador de anuncios y promesas ────────────────────────────────────

  function setupAdBlocker() {
    let isHandlingAd = false;
    let savedVolume = 1;
    let savedMuted = false;

    function checkAndSkipAds() {
      const player = document.querySelector('#movie_player');
      if (!player) return;

      const isAd =
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting');

      if (isAd) {
        const video = document.querySelector('video');
        if (video) {
          if (!isHandlingAd) {
            isHandlingAd = true;
            savedMuted = video.muted;
            savedVolume = video.volume;
            video.muted = true;
            log('Anuncio detectado: silenciando y acelerando...');
          }

          video.playbackRate = 16.0;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        }

        const skipBtn = player.querySelector(
          '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [id^="skip-button"] button'
        );
        if (skipBtn) {
          skipBtn.click();
        }
      } else if (isHandlingAd) {
        const video = document.querySelector('video');
        isHandlingAd = false;
        if (video) {
          video.playbackRate = 1.0;
          video.muted = savedMuted;
          video.volume = savedVolume;
        }
      }

      const youThereBtn = document.querySelector(
        'ytmusic-you-there-renderer #confirm-button, ytmusic-you-there-renderer yt-button-renderer'
      );
      if (youThereBtn) {
        youThereBtn.click();
      }
    }

    setInterval(checkAndSkipAds, 600);
  }

  // ─── Inyección de estilos visuales ────────────────────────────────────────

  function injectCustomStyles() {
    const styleId = 'zumic-custom-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* ── Zumic Custom Theme ── */

      /* Variables de tema */
      :root {
        --zumic-blur: ${CONFIG.BLUR_AMOUNT};
        --zumic-bg-opacity: ${CONFIG.BACKGROUND_OPACITY};
        --zumic-bg-image: ${CONFIG.BACKGROUND_IMAGE || 'none'};
        --zumic-accent: rgba(255, 255, 255, 0.08);
        --zumic-glass: rgba(0, 0, 0, 0.45);
      }

      /* ── Bloqueo de elementos publicitarios y banners de Premium ── */
      ytmusic-mealbar-promo-renderer,
      ytmusic-upsell-dialog-renderer,
      .ytmusic-mealbar-promo-renderer,
      #player-ads,
      .ytp-ad-overlay-container,
      .ytp-ad-message-container,
      ytmusic-companion-ad-renderer,
      ytmusic-statement-banner-renderer,
      .ytmusic-statement-banner-renderer {
        display: none !important;
      }

      /* ── Modo Ahorro / Solo Audio (suspende renderizado de video) ── */
      body.zumic-audio-only #player video,
      body.zumic-audio-only ytmusic-player video,
      body.zumic-audio-only .html5-main-video {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      body.zumic-audio-only ytmusic-player-page #song-video {
        display: none !important;
      }
      body.zumic-audio-only ytmusic-player-page #thumbnail {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* ── Selector Canción / Video (AV Switcher) y Centrado del Player ── */
      ytmusic-player-page #av-id {
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
      }

      #zumic-av-switcher {
        position: relative !important;
        top: auto !important;
        left: auto !important;
        transform: none !important;
        margin: 0 !important;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 100;
        user-select: none;
        pointer-events: auto;
        flex-shrink: 0;
      }

      .zumic-av-pill {
        display: inline-flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9999px;
        padding: 3px;
        gap: 2px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      }

      .zumic-av-btn {
        background: transparent;
        color: rgba(255, 255, 255, 0.7);
        border: none;
        outline: none;
        padding: 6px 20px;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 500;
        font-family: 'Roboto', 'YouTube Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1.2;
      }

      .zumic-av-btn:hover:not(.active):not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      .zumic-av-btn.active {
        background: rgba(255, 255, 255, 0.22) !important;
        color: #ffffff !important;
        font-weight: 600 !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        cursor: default;
      }

      .zumic-av-btn:disabled {
        opacity: 0.35 !important;
        cursor: not-allowed !important;
        pointer-events: auto !important;
      }

      /* Centrado y dimensiones personalizadas SOLO en modo escritorio ancho (>= 936px).
         En modo compacto/estrecho (como 500px en Brave), se respeta el layout móvil nativo
         de YouTube Music (con barra superior v / switcher / ⋮, carátula, título y controles grandes). */
      @media (min-width: 936px) {
        ytmusic-player-page:not([is-mweb-modernization-enabled]) #main-panel {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          position: relative !important;
          padding: 0 0 48px 0 !important;
          box-sizing: border-box !important;
        }

        ytmusic-player-page:not([is-mweb-modernization-enabled]) #av-id {
          margin: 0 0 24px 0 !important;
        }

        /* Tamaño y centrado de la carátula en Modo Canción (cuadrada 1:1) */
        body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
          width: min(56vh, 42vw, 460px) !important;
          height: min(56vh, 42vw, 460px) !important;
          max-width: 460px !important;
          max-height: 460px !important;
          aspect-ratio: 1 / 1 !important;
          margin: 0 auto !important;
          border-radius: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5) !important;
          flex-shrink: 0 !important;
        }

        /* Tamaño y centrado en Modo Video o Miniatura de Video (16:9) */
        body.zumic-mode-video ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player,
        body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
          width: min(76vh, 48vw, 600px) !important;
          height: calc(min(76vh, 48vw, 600px) * 9 / 16) !important;
          max-height: min(52vh, 340px) !important;
          aspect-ratio: 16 / 9 !important;
          margin: 0 auto !important;
          border-radius: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5) !important;
          flex-shrink: 0 !important;
        }
      }

      /* Cuando el modo es Canción (Carátula o Miniatura de video) */
      body.zumic-mode-song ytmusic-player-page:not([player-fullscreened]) #song-video {
        display: none !important;
      }
      body.zumic-mode-song ytmusic-player-page #song-image,
      body.zumic-mode-song ytmusic-player-page #song-image yt-img-shadow,
      body.zumic-mode-song ytmusic-player-page #song-image #thumbnail {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
      }
      body.zumic-mode-song ytmusic-player-page #song-image img {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        border-radius: 8px !important;
      }

      /* Cuando el modo es Video */
      body.zumic-mode-video ytmusic-player-page #song-video {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
      }
      body.zumic-mode-video ytmusic-player-page:not([player-fullscreened]) #song-image {
        display: none !important;
      }

      /* Ocultar visualmente solo el toggle nativo ytmusic-av-toggle (dejando #av-id visible
         para alojar nuestro switcher en la posición exacta tanto en escritorio como en 500px) */
      ytmusic-av-toggle,
      #av-toggle {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Fondo personalizado (solo activo si el usuario configura una imagen con window.zumic.setBackground) */
      body.zumic-has-custom-bg {
        background: transparent !important;
      }

      body.zumic-has-custom-bg::before {
        content: '';
        position: fixed;
        inset: 0;
        z-index: -1;
        background-image: var(--zumic-bg-image);
        background-size: cover;
        background-position: center;
        filter: blur(var(--zumic-blur));
        transform: scale(1.05);
        opacity: var(--zumic-bg-opacity);
      }

      body.zumic-has-custom-bg::after {
        content: '';
        position: fixed;
        inset: 0;
        z-index: -1;
        background: rgba(10, 10, 15, 0.72);
      }
    `;

    // Insertar cuando el head esté disponible
    if (document.head) {
      document.head.appendChild(style);
      log('Estilos personalizados inyectados');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.head.appendChild(style);
        log('Estilos personalizados inyectados (DOMContentLoaded)');
      });
    }
  }

  // ─── Modo Ahorro / Solo Audio ─────────────────────────────────────────────
  let manualAudioOnly = false;
  let autoPowerSaver = false;

  function applyAudioOnlyState() {
    const isAudioOnly = manualAudioOnly || autoPowerSaver;
    const video = document.querySelector('video');
    if (isAudioOnly) {
      document.body.classList.add('zumic-audio-only');
      if (video) video.style.visibility = 'hidden';
      log('Modo Ahorro activo: video oculto');
    } else {
      document.body.classList.remove('zumic-audio-only');
      if (video) video.style.visibility = 'visible';
      log('Modo Ahorro inactivo: video restaurado');
    }

    const btn = document.getElementById('zumic-saver-btn');
    if (btn) {
      // Nota: YouTube Music aplica Trusted Types, por lo que innerHTML con
      // strings lanza una excepción. Se construye el contenido con la API DOM.
      const icon = document.createTextNode(manualAudioOnly ? '🍃 ' : '⚡ ');
      const label = document.createElement('b');
      label.textContent = manualAudioOnly ? 'Ahorro: ON' : 'Ahorro: OFF';
      btn.replaceChildren(icon, label);
      btn.style.background = manualAudioOnly
        ? 'rgba(46, 204, 113, 0.25)'
        : 'rgba(255, 255, 255, 0.08)';
      btn.style.borderColor = manualAudioOnly
        ? '#2ecc71'
        : 'rgba(255, 255, 255, 0.15)';
    }
  }

  function setupAudioOnlyButton() {
    const navRight = document.querySelector('ytmusic-nav-bar .right-content');
    if (!navRight || document.getElementById('zumic-saver-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'zumic-saver-btn';
    btn.title = 'Modo Ahorro / Solo Audio (Reduce consumo de GPU y memoria)';
    btn.style.cssText = `
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 5px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-right: 12px;
      transition: all 0.2s ease;
      user-select: none;
    `;
    btn.addEventListener('click', () => {
      window.zumic.toggleAudioOnly();
    });

    navRight.insertBefore(btn, navRight.firstChild);
    applyAudioOnlyState();
  }

  // ─── Modo Canción / Video (AV Switcher) ──────────────────────────────────
  let currentAVMode = (function() {
    try {
      return localStorage.getItem('zumic_av_mode') || 'song';
    } catch (_) {
      return 'song';
    }
  })();

  // Pistas ATV donde se confirmó que no existe contraparte de video
  const noVideoTrackIds = new Set();
  let pendingAVSwitch = null; // { targetMode: 'song'|'video', videoId: string, timer: number }
  let songImgObserver = null;
  let observedSongImg = null;

  // Caché ligera por videoId + estado de video-mode para evitar llamar a getPlayerResponse() repetidamente
  let cachedTrackDetails = {
    cacheKey: '',
    videoId: '',
    mvType: '',
    bestThumb: '',
  };

  function isSquareCoverUrl(url) {
    return Boolean(url && (url.includes('googleusercontent.com') || url.includes('ggpht.com')));
  }

  function getHighResArtworkUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl;
    if (isSquareCoverUrl(url)) {
      url = url.replace(/=w\d+-h\d+[^=]*$/, '=w1200-h1200-l90-rj');
      url = url.replace(/=s\d+[^=]*$/, '=s1200');
    } else if (url.includes('ytimg.com')) {
      url = url.split('?')[0];
    }
    return url;
  }

  function getTrackDetailsCached() {
    let vid = '';
    const p = document.querySelector('#movie_player');
    const ytPlayer = document.querySelector('ytmusic-player');
    const hasVideoMode = Boolean(ytPlayer?.hasAttribute('video-mode'));
    try {
      vid = p?.getVideoData?.()?.video_id || '';
    } catch (_) {}

    const key = `${vid}|${hasVideoMode}`;
    if (vid && key === cachedTrackDetails.cacheKey && cachedTrackDetails.mvType) {
      return cachedTrackDetails;
    }

    let mvType = '';
    let bestThumb = '';
    try {
      const vd = p?.getPlayerResponse?.()?.videoDetails;
      if (vd) {
        vid = vid || vd.videoId || '';
        mvType = vd.musicVideoType || '';
        const thumbs = vd.thumbnail?.thumbnails;
        if (Array.isArray(thumbs) && thumbs.length > 0) {
          const best = thumbs.reduce((a, b) =>
            (b.width || 0) * (b.height || 0) >= (a.width || 0) * (a.height || 0) ? b : a
          );
          if (best?.url) bestThumb = getHighResArtworkUrl(best.url);
        }
      }
    } catch (_) {}

    cachedTrackDetails = {
      cacheKey: `${vid}|${hasVideoMode}`,
      videoId: vid,
      mvType,
      bestThumb,
    };
    return cachedTrackDetails;
  }

  /**
   * Busca la carátula cuadrada de álbum (googleusercontent.com) en el player bar,
   * mediaSession, playerResponse o el ítem activo de la cola de reproducción.
   */
  function getSquareAlbumCoverUrl() {
    // 1. Miniatura de la barra inferior (ytmusic-player-bar mantiene la carátula aunque se reproduzca el video)
    const barImg = document.querySelector(
      'ytmusic-player-bar .thumbnail-image-wrapper img, ytmusic-player-bar yt-img-shadow.image img, ytmusic-player-bar img.image'
    );
    const barSrc = barImg?.getAttribute('src') || barImg?.src || '';
    if (isSquareCoverUrl(barSrc)) {
      return getHighResArtworkUrl(barSrc);
    }

    // 2. Carátula actual en el reproductor (#song-image / #thumbnail, útil antes de dar Play)
    const songImg = document.querySelector(
      'ytmusic-player-page #song-image img, ytmusic-player-page #thumbnail img'
    );
    const songSrc = songImg?.getAttribute('src') || songImg?.src || '';
    if (isSquareCoverUrl(songSrc)) {
      return getHighResArtworkUrl(songSrc);
    }

    // 3. mediaSession.metadata.artwork
    const artwork = navigator.mediaSession?.metadata?.artwork;
    if (Array.isArray(artwork)) {
      for (const item of artwork) {
        if (isSquareCoverUrl(item?.src)) {
          return getHighResArtworkUrl(item.src);
        }
      }
    }

    // 4. Respuesta del reproductor (#movie_player)
    const { bestThumb } = getTrackDetailsCached();
    if (isSquareCoverUrl(bestThumb)) {
      return bestThumb;
    }

    // 5. Ítem activo en la lista de reproducción ("A continuación")
    const queueImg = document.querySelector(
      'ytmusic-player-queue-item[selected] img, ytmusic-player-queue-item[play-button-state="playing"] img, ytmusic-player-queue-item[play-button-state="paused"] img'
    );
    const queueSrc = queueImg?.getAttribute('src') || queueImg?.src || '';
    if (isSquareCoverUrl(queueSrc)) {
      return getHighResArtworkUrl(queueSrc);
    }

    return '';
  }

  function getBestTrackThumbnailUrl() {
    // Prioridad 1: Carátula cuadrada oficial de la canción (si existe)
    const squareCover = getSquareAlbumCoverUrl();
    if (squareCover) return squareCover;

    // Prioridad 2: Miniatura del video en alta resolución (para videos sin carátula)
    const { videoId, bestThumb } = getTrackDetailsCached();
    if (bestThumb) return bestThumb;

    const raw = getArtworkUrl();
    if (raw) return getHighResArtworkUrl(raw);

    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
  }

  function ensureSongImageObserver() {
    const nativeImg = document.querySelector('ytmusic-player-page #song-image img');
    if (!nativeImg || nativeImg === observedSongImg) return;

    if (songImgObserver) {
      songImgObserver.disconnect();
    }
    observedSongImg = nativeImg;
    songImgObserver = new MutationObserver(() => {
      if (!document.body.classList.contains('zumic-mode-song')) return;
      const src = nativeImg.getAttribute('src') || '';
      const best = getBestTrackThumbnailUrl();
      if (!best) return;

      // Restaurar si YouTube limpia la imagen (data:image) o si puso una miniatura de video habiendo carátula
      const needsRestore =
        !src ||
        src.startsWith('data:image') ||
        (isSquareCoverUrl(best) && !isSquareCoverUrl(src));

      if (needsRestore && src !== best) {
        nativeImg.removeAttribute('srcset');
        nativeImg.src = best;
        const shadow = nativeImg.closest('yt-img-shadow');
        if (shadow) {
          shadow.classList.remove('empty');
          shadow.setAttribute('loaded', '');
        }
      }
    });
    songImgObserver.observe(nativeImg, { attributes: true, attributeFilter: ['src'] });
  }

  function updateCustomArtwork(forceOverwrite = false) {
    ensureSongImageObserver();
    const nativeImg = document.querySelector('ytmusic-player-page #song-image img');
    if (!nativeImg) return;

    const bestUrl = getBestTrackThumbnailUrl();
    if (!bestUrl) return;

    const currentSrc = nativeImg.getAttribute('src') || '';
    const isPlaceholder = !currentSrc || currentSrc.startsWith('data:image');
    const shouldUpgradeToSquareCover = isSquareCoverUrl(bestUrl) && !isSquareCoverUrl(currentSrc);

    if ((isPlaceholder || forceOverwrite || shouldUpgradeToSquareCover) && currentSrc !== bestUrl) {
      nativeImg.removeAttribute('srcset');
      nativeImg.src = bestUrl;
    }

    const imgShadow = document.querySelector('ytmusic-player-page #song-image yt-img-shadow');
    if (imgShadow) {
      imgShadow.classList.remove('empty');
      imgShadow.setAttribute('loaded', '');
    }
  }

  /**
   * Analiza el estado real de la pista y del toggle nativo <ytmusic-av-toggle>:
   * - isATV: true si el stream actual es solo audio con carátula cuadrada (MUSIC_VIDEO_TYPE_ATV)
   * - canSwitch: true si YouTube Music tiene contraparte Canción <-> Video para esta pista
   * - hasVideo: true si la pista actual es un video O si puede cambiar a su contraparte de video
   */
  function getNativeAVState() {
    const { videoId, mvType } = getTrackDetailsCached();
    const ytPlayer = document.querySelector('ytmusic-player');
    const page = document.querySelector('ytmusic-player-page');

    let isATV;
    if (mvType) {
      isATV = mvType === 'MUSIC_VIDEO_TYPE_ATV';
    } else if (!videoId) {
      // Antes de iniciar la reproducción (estado restaurado en frío), asumir canción (ATV)
      isATV = true;
    } else {
      const videoModeAttr =
        Boolean(ytPlayer?.videoMode_) ||
        Boolean(ytPlayer?.hasAttribute('video-mode')) ||
        Boolean(page?.hasAttribute('video-mode'));
      isATV = !videoModeAttr;
    }

    const avToggle = document.querySelector('ytmusic-av-toggle');
    let canSwitch = false;
    if (avToggle) {
      const toggleDisabled =
        avToggle.hasAttribute('toggle-disabled') || Boolean(avToggle.toggleDisabled);
      canSwitch = !toggleDisabled;
    }

    if (videoId && noVideoTrackIds.has(videoId) && isATV) {
      canSwitch = false;
    }

    const hasVideo = !isATV || canSwitch;
    return { videoId, mvType, isATV, canSwitch, hasVideo, avToggle };
  }

  /**
   * Dispara el cambio nativo en <ytmusic-av-toggle> cuando la pista tiene
   * tanto versión Canción (ATV) como versión Video (OMV).
   */
  function triggerNativeAVSwitch(targetMode) {
    const avToggle = document.querySelector('ytmusic-av-toggle');
    if (!avToggle) return false;

    const selector = targetMode === 'video' ? '.video-button' : '.song-button';
    const targetBtn =
      avToggle.querySelector(selector) ||
      avToggle.shadowRoot?.querySelector?.(selector);

    if (!targetBtn) return false;

    targetBtn.click();
    const innerTap = targetBtn.querySelector('button, tp-yt-paper-button, yt-button-renderer');
    if (innerTap) innerTap.click();
    return true;
  }

  function applyAVMode(mode, fromUserClick = false) {
    if (mode !== 'song' && mode !== 'video') {
      mode = 'song';
    }
    currentAVMode = mode;
    try {
      localStorage.setItem('zumic_av_mode', mode);
    } catch (_) {}

    const { videoId, isATV, canSwitch, hasVideo } = getNativeAVState();

    // Si el stream actual no coincide con el modo deseado y la pista soporta cambio nativo (ATV <-> OMV)
    const needsNativeSwitch =
      canSwitch &&
      ((mode === 'video' && isATV) || (mode === 'song' && !isATV));

    if (needsNativeSwitch) {
      const alreadyPending =
        pendingAVSwitch &&
        pendingAVSwitch.targetMode === mode &&
        pendingAVSwitch.videoId === videoId;

      if (fromUserClick || !alreadyPending) {
        if (pendingAVSwitch?.timer) clearTimeout(pendingAVSwitch.timer);
        const clicked = triggerNativeAVSwitch(mode);
        if (clicked && videoId) {
          const startVideoId = videoId;
          // Refrescar carátula apenas el reproductor complete la transición nativa
          setTimeout(() => {
            if (currentAVMode === 'song') updateCustomArtwork(true);
          }, 350);
          const timer = setTimeout(() => {
            const afterState = getNativeAVState();
            if (mode === 'video' && afterState.isATV && afterState.videoId === startVideoId) {
              noVideoTrackIds.add(startVideoId);
            }
            pendingAVSwitch = null;
            applyAVMode(currentAVMode, false);
          }, 1600);
          pendingAVSwitch = { targetMode: mode, videoId: startVideoId, timer };
        }
      }
    } else if (pendingAVSwitch) {
      clearTimeout(pendingAVSwitch.timer);
      pendingAVSwitch = null;
    }

    // Solo mostramos #song-video cuando el usuario eligió 'video' Y el stream cargado NO es solo-audio (ATV).
    const showVideo = mode === 'video' && hasVideo && !isATV;
    const showSong = !showVideo;

    const bestThumbUrl = showSong ? getBestTrackThumbnailUrl() : '';
    const hasSquareCover = isSquareCoverUrl(bestThumbUrl);

    // Solo usamos el formato 16:9 en modo Canción cuando la pista es un video que NO tiene carátula cuadrada
    const isVideoThumbnailInSongMode = showSong && !isATV && !hasSquareCover;

    if (document.body) {
      document.body.classList.toggle('zumic-mode-song', showSong);
      document.body.classList.toggle('zumic-mode-video', showVideo);
      document.body.classList.toggle('zumic-video-thumbnail-mode', isVideoThumbnailInSongMode);
    }

    const songBtn = document.getElementById('zumic-av-btn-song');
    const videoBtn = document.getElementById('zumic-av-btn-video');
    if (songBtn && videoBtn) {
      const effectiveActiveMode = !hasVideo ? 'song' : mode;
      songBtn.classList.toggle('active', effectiveActiveMode === 'song');
      videoBtn.classList.toggle('active', effectiveActiveMode === 'video');
      videoBtn.disabled = !hasVideo;
      videoBtn.title = hasVideo ? '' : 'Esta canción no tiene video disponible';
    }

    if (showSong) {
      updateCustomArtwork(fromUserClick || isVideoThumbnailInSongMode);
    }

    log(`Modo AV: ${mode} | isATV=${isATV} | canSwitch=${canSwitch} | hasSquareCover=${hasSquareCover}`);
  }

  function createAVButton(id, text, mode) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'zumic-av-btn';
    btn.textContent = text;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!btn.disabled) applyAVMode(mode, true);
    });
    return btn;
  }

  function setupSongVideoSwitcher() {
    const container =
      document.querySelector('ytmusic-player-page #av-id') ||
      document.querySelector('ytmusic-player-page #main-panel');
    if (!container) return;

    let switcher = document.getElementById('zumic-av-switcher');
    if (switcher && switcher.parentElement !== container) {
      switcher.remove();
      switcher = null;
    }

    if (!switcher) {
      switcher = document.createElement('div');
      switcher.id = 'zumic-av-switcher';

      const pill = document.createElement('div');
      pill.className = 'zumic-av-pill';
      pill.append(
        createAVButton('zumic-av-btn-song', 'Canción', 'song'),
        createAVButton('zumic-av-btn-video', 'Video', 'video'),
      );
      switcher.appendChild(pill);

      container.insertBefore(switcher, container.firstChild);
      log('Switcher [ Canción | Video ] inyectado');
    }

    applyAVMode(currentAVMode, false);
  }

  // ─── API pública expuesta en window ───────────────────────────────────────

  window.zumic = {
    setBackground(imageUrl, blur = '20px', opacity = 0.3) {
      const root = document.documentElement;
      root.style.setProperty('--zumic-bg-image', imageUrl);
      root.style.setProperty('--zumic-blur', blur);
      root.style.setProperty('--zumic-bg-opacity', String(opacity));
      CONFIG.BACKGROUND_IMAGE = imageUrl;
      CONFIG.BLUR_AMOUNT = blur;
      CONFIG.BACKGROUND_OPACITY = opacity;
      document.body?.classList.toggle(
        'zumic-has-custom-bg',
        Boolean(imageUrl && imageUrl !== 'none')
      );
    },
    clearBackground() {
      this.setBackground('none', '0px', 0);
    },
    setDebug(enabled) {
      CONFIG.DEBUG = enabled;
    },
    syncNow: syncMetadata,
    getMetadata: extractMetadata,
    togglePlay() {
      try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.getPlayerState === 'function') {
          if (p.getPlayerState() === 1) {
            p.pauseVideo();
          } else {
            p.playVideo();
          }
          return;
        }
      } catch (_) {}

      const btn =
        document.querySelector('ytmusic-player-bar #play-pause-button') ||
        document.querySelector('#play-pause-button');
      if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
        return;
      }

      const v = document.querySelector('video');
      if (v) {
        if (v.paused) v.play(); else v.pause();
      }
    },
    nextTrack() {
      try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.nextVideo === 'function') {
          p.nextVideo();
          return;
        }
      } catch (_) {}

      const btn =
        document.querySelector('ytmusic-player-bar .next-button') ||
        document.querySelector('.next-button');
      if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
      }
    },
    prevTrack() {
      try {
        const p = document.querySelector('#movie_player');
        if (p && typeof p.previousVideo === 'function') {
          p.previousVideo();
          return;
        }
      } catch (_) {}

      const btn =
        document.querySelector('ytmusic-player-bar .previous-button') ||
        document.querySelector('.previous-button');
      if (btn) {
        btn.click();
        const inner = btn.querySelector('button');
        if (inner) inner.click();
      }
    },
    toggleAudioOnly() {
      manualAudioOnly = !manualAudioOnly;
      applyAudioOnlyState();
      return manualAudioOnly;
    },
    setAudioOnly(enabled) {
      manualAudioOnly = Boolean(enabled);
      applyAudioOnlyState();
    },
    setAutoPowerSaver(enabled) {
      autoPowerSaver = Boolean(enabled);
      applyAudioOnlyState();
    },
    isAudioOnly() {
      return manualAudioOnly || autoPowerSaver;
    },
    setAVMode: applyAVMode,
    toggleAVMode() {
      applyAVMode(currentAVMode === 'song' ? 'video' : 'song', true);
      return currentAVMode;
    },
    getAVMode() {
      return currentAVMode;
    },
  };

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  function bootstrap() {
    log('Zumic Init cargando...');
    injectCustomStyles();
    setupMediaSessionObserver();
    setupDomObserver();
    setupVideoObserver();
    setupAdBlocker();

    // Intentar inyectar el botón de ahorro en la barra de navegación
    setupAudioOnlyButton();
    const saverBtnInterval = setInterval(() => {
      if (document.getElementById('zumic-saver-btn')) {
        clearInterval(saverBtnInterval);
      } else {
        setupAudioOnlyButton();
      }
    }, 1500);

    // Inyectar y sincronizar selector [ Canción | Video ]
    setupSongVideoSwitcher();
    let lastAVSignature = '';
    setInterval(() => {
      const container =
        document.querySelector('ytmusic-player-page #av-id') ||
        document.querySelector('ytmusic-player-page #main-panel');
      if (!container) return;
      const switcher = document.getElementById('zumic-av-switcher');
      if (!switcher || switcher.parentElement !== container) {
        setupSongVideoSwitcher();
        return;
      }

      const { videoId, mvType, isATV, canSwitch } = getNativeAVState();
      const signature = `${videoId}|${mvType}|${isATV}|${canSwitch}`;
      if (videoId && signature !== lastAVSignature) {
        lastAVSignature = signature;
        applyAVMode(currentAVMode, false);
        setTimeout(() => applyAVMode(currentAVMode, false), 450);
      }
    }, 1000);

    // Polling de respaldo para progreso de reproducción
    progressInterval = setInterval(() => {
      if (lastMetadata?.is_playing) {
        const { currentTime, duration } = getVideoProgress();
        const updated = { ...lastMetadata, current_time_secs: currentTime, duration_secs: duration };
        if (Math.abs(currentTime - (lastMetadata.current_time_secs || 0)) > 5) {
          lastMetadata = updated;
          invokeUpdatePresence(updated);
        }
      }
    }, CONFIG.PROGRESS_INTERVAL_MS);

    log('Zumic Init listo.');
  }

  // Diferir la inicialización hasta que la página termine su carga inicial
  // para no competir con la hidratación de Polymer de YouTube Music
  if (document.readyState === 'complete') {
    setTimeout(bootstrap, 150);
  } else {
    window.addEventListener('load', () => setTimeout(bootstrap, 150), { once: true });
  }

})();
