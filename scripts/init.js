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
  // No ejecutar nunca dentro de iframes secundarios ni fuera de music.youtube.com (ej. login de Google)
  if (window !== window.top) return;
  if (window.location.hostname !== 'music.youtube.com') return;

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
  function getTauriInvoke() {
    return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
  }

  async function invokeUpdatePresence(metadata) {
    try {
      const invoke = getTauriInvoke();
      if (invoke) {
        await invoke('update_presence', { metadata });
        log('Presencia actualizada:', metadata.title);
      }
    } catch (err) {
      console.warn('[Zumic] Error al invocar update_presence:', err);
    }
  }

  async function invokeClearPresence() {
    try {
      const invoke = getTauriInvoke();
      if (invoke) {
        await invoke('clear_presence');
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
      lastMetadata.track_url !== newMeta.track_url ||
      lastMetadata.artwork_url !== newMeta.artwork_url
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
    const bestThumb = getBestTrackThumbnailUrl() || metadata.artwork_url;
    if (bestThumb && !manualAudioOnly && !autoPowerSaver) {
      updateDynamicBackground(bestThumb);
    }

    if (hasMetadataChanged(metadata)) {
      const trackChanged =
        !lastMetadata ||
        lastMetadata.title !== metadata.title ||
        lastMetadata.artist !== metadata.artist ||
        lastMetadata.track_url !== metadata.track_url;
      lastMetadata = metadata;
      if (trackChanged) {
        applyAVMode(currentAVMode, false);
        setTimeout(() => applyAVMode(currentAVMode, false), 350);
      }
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
      video.addEventListener('play', () => {
        scheduleSyncMetadata(150);
        if (!hasRestoredVolume) {
          restoreSavedVolume();
        }
      });
      video.addEventListener('pause', () => scheduleSyncMetadata(150));
      video.addEventListener('ended', () => invokeClearPresence());
      video.addEventListener('volumechange', () => {
        if (!video.muted) {
          try {
            const vol = Math.round(video.volume * 100);
            localStorage.setItem('zumic_saved_volume', String(vol));
          } catch (_) {}
        }
      });
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

      /* ── Ocultar botón de transmitir / Chromecast (no utilizado en escritorio) ── */
      ytmusic-cast-button,
      .cast-button,
      #cast-button,
      tp-yt-paper-icon-button[aria-label*="transmitir" i],
      tp-yt-paper-icon-button[aria-label*="conectar" i],
      tp-yt-paper-icon-button[aria-label*="cast" i],
      button[aria-label*="transmitir" i],
      button[aria-label*="conectar" i],
      button[aria-label*="cast" i] {
        display: none !important;
      }

      /* ── Indicador flotante de porcentaje de volumen estilo Glassy Music ── */
      ytmusic-app-layout[player-page-open] ytmusic-player,
      ytmusic-app-layout[player-page-open] #player {
        position: relative !important;
      }

      /* Neutralizar el transform inline del miniplayer de YouTube Music al abrir la vista de
         canción para que la carátula suba bloqueada junto con [ Canción | Video ] y la cola */
      ytmusic-app-layout[player-page-open] ytmusic-player-page:not([player-fullscreened]) ytmusic-player,
      ytmusic-app-layout[player-page-open] ytmusic-player-page:not([player-fullscreened]) #player {
        transform: none !important;
      }

      /* Transición homogénea entre Principal/Explorar/Biblioteca y la vista de reproducción:
         ocultar de inmediato la pantalla inferior al desplegar la canción para que nunca
         se superpongan ambas vistas a través del fondo transparente */
      ytmusic-app-layout #browse-page,
      ytmusic-app-layout #search-page,
      ytmusic-app-layout ytmusic-browse-response,
      ytmusic-app-layout ytmusic-search-page,
      ytmusic-app-layout > #background,
      ytmusic-app-layout #immersive-background,
      ytmusic-app-layout ytmusic-fullbleed-thumbnail-renderer {
        transition: opacity 0.2s cubic-bezier(0.2, 0, 0, 1) !important;
      }

      ytmusic-app-layout[player-page-open] #browse-page,
      ytmusic-app-layout[player-page-open] #search-page,
      ytmusic-app-layout[player-page-open] ytmusic-browse-response,
      ytmusic-app-layout[player-page-open] ytmusic-search-page,
      ytmusic-app-layout[player-page-open] > #background,
      ytmusic-app-layout[player-page-open] #immersive-background,
      ytmusic-app-layout[player-page-open] ytmusic-fullbleed-thumbnail-renderer {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: none !important;
      }

      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.16s ease, transform 0.26s cubic-bezier(0.2, 0, 0, 1) !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page {
        opacity: 1 !important;
        transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.2, 0, 0, 1) !important;
      }

      #zumic-volume-hud {
        position: absolute !important;
        top: 16px !important;
        left: 20px !important;
        z-index: 2147483640 !important;
        pointer-events: none !important;
        color: rgba(255, 255, 255, 0.95) !important;
        font-size: clamp(32px, 5vw, 50px) !important;
        font-weight: 800 !important;
        font-family: 'YouTube Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif !important;
        letter-spacing: -0.5px !important;
        line-height: 1 !important;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.75), 0 0 24px rgba(0, 0, 0, 0.5) !important;
        opacity: 0 !important;
        transform: translateY(-2px) scale(0.96) !important;
        transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.2, 0, 0, 1) !important;
        user-select: none !important;
      }

      #zumic-volume-hud.visible {
        opacity: 1 !important;
        transform: translateY(0) scale(1) !important;
      }

      /* ── Hitbox ampliada para la barra de progreso de tiempo ── */
      ytmusic-player-bar #progress-bar {
        position: absolute !important;
        top: -11px !important;
        height: 24px !important;
        padding: 0 !important;
        cursor: pointer !important;
        z-index: 100 !important;
        display: flex !important;
        align-items: center !important;
      }

      /* Contenedores internos del slider centrados en la hitbox de 24px */
      ytmusic-player-bar #progress-bar #sliderContainer,
      ytmusic-player-bar #progress-bar .slider-container {
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
        cursor: pointer !important;
      }

      ytmusic-player-bar #progress-bar #sliderBar,
      ytmusic-player-bar #progress-bar .slider-bar {
        height: 3px !important;
        transition: height 0.15s cubic-bezier(0.2, 0, 0, 1) !important;
      }

      /* Engrosar la barra a 6px al pasar el ratón para dar feedback visual claro */
      ytmusic-player-bar #progress-bar:hover #sliderBar,
      ytmusic-player-bar #progress-bar:hover .slider-bar {
        height: 6px !important;
      }

      /* Scrubber knob (botón de arrastre) más accesible */
      ytmusic-player-bar #progress-bar #sliderKnob,
      ytmusic-player-bar #progress-bar .slider-knob {
        cursor: pointer !important;
      }

      ytmusic-player-bar #progress-bar:hover #sliderKnobInner,
      ytmusic-player-bar #progress-bar:hover .slider-knob-inner {
        transform: scale(1.2) !important;
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
        visibility: inherit !important;
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

      /* Centrado y dimensiones del panel del reproductor cuando NO está en modo móvil (is-mweb-modernization-enabled).
         Cubre tanto escritorio ancho (>= 936px) como resoluciones intermedias/apiladas (500px - 935px). */
      ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        box-sizing: border-box !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #av-id {
        width: 100% !important;
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
      }

      @media (min-width: 936px) {
        ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel {
          padding: 0 0 48px 0 !important;
        }

        ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #av-id {
          margin: 0 0 24px 0 !important;
        }

        /* Tamaño y centrado de la carátula en Modo Canción (cuadrada 1:1) */
        body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
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
        body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player,
        body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
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

      @media (max-width: 935px) {
        ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel {
          padding: 8px 0 16px 0 !important;
          flex: 0 0 auto !important;
          height: auto !important;
          width: 100% !important;
        }

        ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #av-id {
          margin: 0 0 14px 0 !important;
        }

        /* Carátula 1:1 proporcionada en resoluciones intermedias (panel apilado arriba) */
        body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
          width: min(36vh, 56vw, 310px) !important;
          height: min(36vh, 56vw, 310px) !important;
          max-width: 310px !important;
          max-height: 310px !important;
          aspect-ratio: 1 / 1 !important;
          margin: 0 auto !important;
          border-radius: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5) !important;
          flex-shrink: 0 !important;
        }

        /* Video o Miniatura 16:9 proporcionada en resoluciones intermedias */
        body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player,
        body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-app-layout[player-page-open] ytmusic-player-page:not([is-mweb-modernization-enabled]):not([player-fullscreened]) #main-panel #player {
          width: min(56vh, 76vw, 440px) !important;
          height: calc(min(56vh, 76vw, 440px) * 9 / 16) !important;
          max-width: 440px !important;
          max-height: min(35vh, 248px) !important;
          aspect-ratio: 16 / 9 !important;
          margin: 0 auto !important;
          border-radius: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5) !important;
          flex-shrink: 0 !important;
        }
      }

      /* ── Dimensiones explícitas en modo compacto / 4:3 / móvil (is-mweb-modernization-enabled)
         para que #player nunca colapse a 0px cuando #song-video está oculto, sin alterar #main-panel
         para respetar la posición superior nativa de la barra [ v | Canción/Video | ⋮ ] ── */
      body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-app-layout[player-page-open] ytmusic-player-page[is-mweb-modernization-enabled]:not([player-fullscreened]) #player {
        width: min(42vh, 78vw, 340px) !important;
        height: min(42vh, 78vw, 340px) !important;
        max-width: 340px !important;
        max-height: 340px !important;
        aspect-ratio: 1 / 1 !important;
        margin: 0 auto !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5) !important;
        flex-shrink: 0 !important;
      }

      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page[is-mweb-modernization-enabled]:not([player-fullscreened]) #player,
      body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-app-layout[player-page-open] ytmusic-player-page[is-mweb-modernization-enabled]:not([player-fullscreened]) #player {
        width: min(92vw, 480px) !important;
        height: calc(min(92vw, 480px) * 9 / 16) !important;
        max-width: 480px !important;
        max-height: 42vh !important;
        aspect-ratio: 16 / 9 !important;
        margin: 0 auto !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5) !important;
        flex-shrink: 0 !important;
      }

      /* ── Modo Pantalla Completa (player-fullscreened) ──
         Centrado absoluto del reproductor sin el desplazamiento lateral de la barra de navegación,
         respetando la altura de ytmusic-player-bar abajo para que los controles y la barra de
         progreso sean 100% interactivos en pantalla completa. */
      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: var(--ytmusic-player-bar-height, 64px) !important;
        width: 100vw !important;
        height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 3 !important;
      }

      ytmusic-player-bar {
        z-index: 300 !important;
        pointer-events: auto !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #side-panel,
      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #top-player-bar {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #main-panel {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: var(--ytmusic-player-bar-height, 64px) !important;
        width: 100vw !important;
        height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        max-width: 100vw !important;
        max-height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #av-id {
        position: absolute !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: auto !important;
        margin: 0 !important;
        z-index: 200 !important;
        opacity: 0 !important;
        transition: opacity 0.25s ease !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #main-panel:hover #av-id {
        opacity: 1 !important;
      }

      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] ytmusic-player,
      ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #player {
        position: relative !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        max-width: 100vw !important;
        max-height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: transparent !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }

      /* Cuando el modo es Canción (Carátula o Miniatura de video) y el reproductor está abierto */
      body.zumic-mode-song ytmusic-player-page #song-video {
        display: none !important;
      }
      body.zumic-mode-song ytmusic-app-layout[player-page-open] ytmusic-player-page #song-image,
      body.zumic-mode-song ytmusic-app-layout[player-page-open] ytmusic-player-page #song-image yt-img-shadow,
      body.zumic-mode-song ytmusic-app-layout[player-page-open] ytmusic-player-page #song-image #thumbnail {
        display: block !important;
        position: relative !important;
        inset: 0 !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background-color: transparent !important;
      }
      body.zumic-mode-song ytmusic-app-layout[player-page-open] ytmusic-player-page #song-image img {
        display: block !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        object-fit: cover !important;
        object-position: center center !important;
        transform: none !important;
        border-radius: 8px !important;
      }

      /* En Pantalla Completa: mantener Carátulas de álbum en proporción cuadrada 1:1 centrada sin zoom */
      body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #song-image {
        width: min(78vh, 78vw) !important;
        height: min(78vh, 78vw) !important;
        max-width: min(78vh, 78vw) !important;
        max-height: min(78vh, 78vw) !important;
        aspect-ratio: 1 / 1 !important;
        margin: auto !important;
        border-radius: 12px !important;
        overflow: hidden !important;
        box-shadow: 0 20px 56px rgba(0, 0, 0, 0.65) !important;
        flex-shrink: 0 !important;
      }

      body.zumic-mode-song:not(.zumic-video-thumbnail-mode) ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #song-image img {
        border-radius: 12px !important;
      }

      /* En Pantalla Completa: las Miniaturas de video (16:9) ocupan y se centran en toda la pantalla */
      body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #song-image {
        width: 100vw !important;
        height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        max-width: 100vw !important;
        max-height: calc(100vh - var(--ytmusic-player-bar-height, 64px)) !important;
        margin: 0 auto !important;
        border-radius: 0 !important;
      }

      body.zumic-mode-song.zumic-video-thumbnail-mode ytmusic-app-layout[player-page-open] ytmusic-player-page[player-fullscreened] #song-image img {
        object-fit: contain !important;
        object-position: center center !important;
        border-radius: 0 !important;
      }

      /* Cuando el modo es Video y el reproductor está abierto: forzar 100% también en #movie_player y <video>
         para que nunca aparezca pequeño arriba a la izquierda al cambiar rápido ni descentrado en pantalla completa */
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video,
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video .player-wrapper,
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video #movie_player,
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video .html5-video-player,
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video .html5-video-container {
        display: block !important;
        position: relative !important;
        top: 0 !important;
        left: 0 !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video video.html5-main-video,
      body.zumic-mode-video ytmusic-app-layout[player-page-open] ytmusic-player-page #song-video video {
        display: block !important;
        position: relative !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        object-fit: contain !important;
        object-position: center center !important;
      }

      body.zumic-mode-video ytmusic-player-page #song-image {
        display: none !important;
      }

      /* Ocultar el reproductor flotante / miniplayer en TODAS las resoluciones cuando la página
         del reproductor está cerrada (ej. en Principal, Explorar, Biblioteca) o en estado MINIPLAYER / PLAYER_BAR_ONLY / INACTIVE */
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #main-panel,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #side-panel,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #top-player-bar,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page ytmusic-player,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #player,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #song-image,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #song-image img,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #song-video,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page video,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #av-id,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #zumic-av-switcher,
      ytmusic-player[player-ui-state="MINIPLAYER"],
      ytmusic-player[player-ui-state="MINIPLAYER"] #song-image,
      ytmusic-player[player-ui-state="MINIPLAYER"] #song-image img,
      ytmusic-player[player-ui-state="MINIPLAYER"] #song-video,
      ytmusic-player[player-ui-state="MINIPLAYER"] video,
      ytmusic-player[player-ui-state="PLAYER_BAR_ONLY"],
      ytmusic-player[player-ui-state="PLAYER_BAR_ONLY"] #song-image,
      ytmusic-player[player-ui-state="PLAYER_BAR_ONLY"] #song-image img,
      ytmusic-player[player-ui-state="PLAYER_BAR_ONLY"] #song-video,
      ytmusic-player[player-ui-state="PLAYER_BAR_ONLY"] video,
      ytmusic-player[player-ui-state="INACTIVE"],
      ytmusic-player[player-ui-state="INACTIVE"] #song-image,
      ytmusic-player[player-ui-state="INACTIVE"] #song-image img,
      ytmusic-player[player-ui-state="INACTIVE"] #song-video,
      ytmusic-player[player-ui-state="INACTIVE"] video {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page ytmusic-player,
      ytmusic-app-layout:not([player-page-open]) ytmusic-player-page #player {
        transform: translate3d(0, 100vh, 0) !important;
        transition: none !important;
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

      /* ── Fondo Difuminado Dinámico de Carátula (Cero consumo GPU adicional) ── */
      #zumic-dynamic-bg {
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.8s ease;
      }

      #zumic-dynamic-bg .zumic-bg-layer {
        position: absolute;
        inset: -20%;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        filter: blur(80px) saturate(1.3) brightness(0.58);
        transform: translateZ(0);
        will-change: transform, opacity;
      }

      /* Velo homogéneo y suave en toda la ventana sin bandas ni cortes bruscos */
      #zumic-dynamic-bg::after {
        content: '';
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 35%, rgba(3, 3, 3, 0.25) 0%, rgba(3, 3, 3, 0.58) 70%, rgba(3, 3, 3, 0.78) 100%),
          linear-gradient(
            to bottom,
            rgba(3, 3, 3, 0.2) 0%,
            rgba(3, 3, 3, 0.45) 50%,
            rgba(3, 3, 3, 0.68) 100%
          );
        pointer-events: none;
      }

      /* Permitir que el fondo difuminado sea visible de manera uniforme en toda la app */
      body:not(.zumic-audio-only) ytmusic-app,
      body:not(.zumic-audio-only) ytmusic-app-layout,
      body:not(.zumic-audio-only) #content.ytmusic-app,
      body:not(.zumic-audio-only) ytmusic-player-page:not([is-mweb-modernization-enabled]),
      body:not(.zumic-audio-only) ytmusic-app-layout > [slot="player-page"] {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* Barra lateral izquierda integrada de forma homogénea con el difuminado (incluso al hacer scroll) */
      body:not(.zumic-audio-only) #mini-guide-background,
      body:not(.zumic-audio-only) #guide-wrapper,
      body:not(.zumic-audio-only) ytmusic-guide-renderer,
      body:not(.zumic-audio-only) #mini-guide,
      body:not(.zumic-audio-only) ytmusic-app-layout tp-yt-app-drawer:not([opened]) #contentContainer {
        background: transparent !important;
        background-color: transparent !important;
        border-right: none !important;
        box-shadow: none !important;
      }

      /* Barra de navegación superior con transición difuminada suave sin cortes al bajar el scroll */
      body:not(.zumic-audio-only) ytmusic-nav-bar {
        background: transparent !important;
        background-color: transparent !important;
        border-bottom: none !important;
      }

      body:not(.zumic-audio-only) #nav-bar-background {
        background: linear-gradient(
          to bottom,
          rgba(3, 3, 3, 0.65) 0%,
          rgba(3, 3, 3, 0.35) 65%,
          rgba(3, 3, 3, 0) 100%
        ) !important;
        background-color: transparent !important;
        border-bottom: none !important;
        box-shadow: none !important;
      }

      body:not(.zumic-audio-only) #nav-bar-divider {
        display: none !important;
        opacity: 0 !important;
      }

      /* En la página principal (Home / Explorar / Moods), aplicar máscara de desvanecimiento
         suave al banner superior para eliminar por completo la línea horizontal de corte */
      body:not(.zumic-audio-only) ytmusic-app-layout > #background,
      body:not(.zumic-audio-only) ytmusic-app-layout #immersive-background,
      body:not(.zumic-audio-only) ytmusic-fullbleed-thumbnail-renderer,
      body:not(.zumic-audio-only) ytmusic-browse-response #background {
        -webkit-mask-image: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.9) 0%,
          rgba(0, 0, 0, 0.55) 40%,
          rgba(0, 0, 0, 0.15) 75%,
          rgba(0, 0, 0, 0) 100%
        ) !important;
        mask-image: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.9) 0%,
          rgba(0, 0, 0, 0.55) 40%,
          rgba(0, 0, 0, 0.15) 75%,
          rgba(0, 0, 0, 0) 100%
        ) !important;
      }

      body:not(.zumic-audio-only) ytmusic-browse-response,
      body:not(.zumic-audio-only) ytmusic-browse-response .background-gradient,
      body:not(.zumic-audio-only) ytmusic-browse-response .gradient-container,
      body:not(.zumic-audio-only) ytmusic-browse-response ytmusic-section-list-renderer,
      body:not(.zumic-audio-only) ytmusic-browse-response #contents.ytmusic-section-list-renderer,
      body:not(.zumic-audio-only) ytmusic-section-list-renderer {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }

      /* Desactivación TOTAL en Modo Ahorro / Solo Audio */
      body.zumic-audio-only #zumic-dynamic-bg {
        display: none !important;
      }

      /* Fondo personalizado manual */
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

  // ─── Fondo difuminado dinámico de carátula ────────────────────────────────
  let lastDynamicBgUrl = '';

  function ensureDynamicBackgroundElement() {
    let container = document.getElementById('zumic-dynamic-bg');
    if (!container && document.body) {
      container = document.createElement('div');
      container.id = 'zumic-dynamic-bg';
      container.setAttribute('aria-hidden', 'true');

      const layer = document.createElement('div');
      layer.className = 'zumic-bg-layer';
      container.appendChild(layer);

      document.body.prepend(container);
    }
    return container;
  }

  function updateDynamicBackground(bestUrl) {
    if (manualAudioOnly || autoPowerSaver) {
      return;
    }

    const container = ensureDynamicBackgroundElement();
    if (!container) return;
    const layer = container.querySelector('.zumic-bg-layer');
    if (!layer) return;

    if (!bestUrl) {
      container.style.opacity = '0';
      return;
    }

    if (bestUrl === lastDynamicBgUrl) {
      return;
    }

    lastDynamicBgUrl = bestUrl;
    layer.style.backgroundImage = `url("${bestUrl}")`;
    container.style.opacity = '1';
  }

  // ─── Control de Volumen con Rueda del Ratón (Inspirado en Glassy Music) ───
  let volumeHudTimer = null;

  function ensureVolumeHudElement() {
    let hud = document.getElementById('zumic-volume-hud');
    if (!hud) {
      const player = document.querySelector('ytmusic-player-page #player, ytmusic-player');
      if (player) {
        hud = document.createElement('div');
        hud.id = 'zumic-volume-hud';
        hud.textContent = '';
        player.appendChild(hud);
      }
    }
    return hud;
  }

  function showVolumeHud(volumePercent) {
    const hud = ensureVolumeHudElement();
    if (!hud) return;

    hud.textContent = `${Math.round(volumePercent)}%`;
    hud.classList.add('visible');

    if (volumeHudTimer) clearTimeout(volumeHudTimer);
    volumeHudTimer = setTimeout(() => {
      hud.classList.remove('visible');
    }, 1300);
  }

  function getCurrentVolume() {
    const p = document.querySelector('#movie_player');
    if (p && typeof p.getVolume === 'function') {
      return p.getVolume();
    }
    const v = document.querySelector('video');
    if (v) {
      return Math.round(v.volume * 100);
    }
    const slider = document.querySelector('ytmusic-player-bar #volume-slider');
    if (slider && slider.value !== undefined) {
      return Number(slider.value);
    }
    return 100;
  }

  let hasRestoredVolume = false;

  function restoreSavedVolume() {
    let saved = null;
    try {
      const raw = localStorage.getItem('zumic_saved_volume');
      if (raw !== null && raw !== '' && !isNaN(Number(raw))) {
        saved = Number(raw);
      }
    } catch (_) {}

    if (saved === null) return;

    const applyRestoration = () => {
      const p = document.querySelector('#movie_player');
      const v = document.querySelector('video');
      if ((p && typeof p.setVolume === 'function') || v) {
        setVolume(saved, false);
        log(`Volumen restaurado al iniciar: ${saved}%`);
        return true;
      }
      return false;
    };

    if (applyRestoration()) {
      hasRestoredVolume = true;
      return;
    }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (applyRestoration() || attempts > 30) {
        hasRestoredVolume = true;
        clearInterval(timer);
      }
    }, 350);
  }

  function setVolume(newVol, showHud = true) {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)));

    // Guardar inmediatamente para recordar volumen entre reinicios
    try {
      localStorage.setItem('zumic_saved_volume', String(clamped));
    } catch (_) {}

    // 1. YouTube HTML5 player API (#movie_player)
    const p = document.querySelector('#movie_player');
    if (p) {
      if (typeof p.unMute === 'function' && p.isMuted?.() && clamped > 0) {
        p.unMute();
      }
      if (typeof p.setVolume === 'function') {
        p.setVolume(clamped);
      }
    }

    // 2. Elemento <video> nativo
    const v = document.querySelector('video');
    if (v) {
      v.volume = clamped / 100;
      if (v.muted && clamped > 0) v.muted = false;
    }

    // 3. Sincronizar slider de volumen en la barra inferior si existe
    const slider = document.querySelector('ytmusic-player-bar #volume-slider');
    if (slider) {
      slider.value = clamped;
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Mostrar HUD solo durante interacción (no durante restauración inicial)
    if (showHud) {
      showVolumeHud(clamped);
    }
    return clamped;
  }

  function setupVolumeWheelControl() {
    window.addEventListener(
      'wheel',
      (e) => {
        const target = e.target;
        if (!target) return;

        // Comprobar si el cursor está sobre la carátula o el reproductor de video
        const isOverPlayerCard = Boolean(
          target.closest('ytmusic-player-page #player, ytmusic-player, #song-image, #song-video, #thumbnail')
        );
        if (!isOverPlayerCard) return;

        // Evitar scroll vertical de la página mientras se rueda sobre la carátula o video
        e.preventDefault();
        e.stopPropagation();

        const current = getCurrentVolume();
        const step = e.shiftKey ? 5 : 2;
        const delta = e.deltaY < 0 ? step : -step;
        const next = Math.max(0, Math.min(100, current + delta));

        setVolume(next, true);
      },
      { passive: false }
    );

    // Guardar volumen actual antes de cerrar o recargar la ventana
    window.addEventListener('beforeunload', () => {
      try {
        const cur = getCurrentVolume();
        localStorage.setItem('zumic_saved_volume', String(cur));
      } catch (_) {}
    });

    log('Control de volumen con rueda de ratón (Glassy style) inicializado');
  }

  // ─── Hitbox interactiva para la barra de progreso de tiempo ───────────────
  function setupProgressBarHitbox() {
    const attachToBar = () => {
      const bar = document.querySelector('ytmusic-player-bar #progress-bar');
      if (!bar || bar.__zumic_hitbox_active__) return;
      bar.__zumic_hitbox_active__ = true;

      const seekFromMouseEvent = (e) => {
        const rect = bar.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const { duration } = getVideoProgress();
        if (duration > 0) {
          const targetSecs = ratio * duration;
          const p = document.querySelector('#movie_player');
          if (p && typeof p.seekTo === 'function') {
            p.seekTo(targetSecs, true);
          } else {
            const v = document.querySelector('video');
            if (v) v.currentTime = targetSecs;
          }
          scheduleSyncMetadata(60);
        }
      };

      bar.addEventListener('click', seekFromMouseEvent);
      log('Hitbox ampliada de barra de progreso configurada');
    };

    attachToBar();
    setInterval(attachToBar, 2000);
  }

  // ─── Modo Ahorro / Solo Audio ─────────────────────────────────────────────
  let manualAudioOnly = false;
  let autoPowerSaver = false;

  function applyAudioOnlyState() {
    const isAudioOnly = manualAudioOnly || autoPowerSaver;
    const video = document.querySelector('video');
    const dynamicBg = document.getElementById('zumic-dynamic-bg');

    if (isAudioOnly) {
      document.body.classList.add('zumic-audio-only');
      if (video) video.style.visibility = 'hidden';
      if (dynamicBg) dynamicBg.style.display = 'none';
      log('Modo Ahorro activo: video y fondo difuminado suspendidos');
    } else {
      document.body.classList.remove('zumic-audio-only');
      if (video) video.style.removeProperty('visibility');
      if (dynamicBg) {
        dynamicBg.style.display = '';
        updateDynamicBackground(getBestTrackThumbnailUrl());
      }
      log('Modo Ahorro inactivo: video y fondo difuminado restaurados');
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

  // Pistas donde se confirmó que no existe contraparte de video o de canción
  const noVideoTrackIds = new Set();
  const noSongTrackIds = new Set();
  const attemptedAutoSwitchKeys = new Set();
  const failedThumbUrls = new Set();
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

  function extractVideoIdFromUrl(url) {
    if (!url) return '';
    const m = url.match(/(?:\/vi(?:_webp)?\/|[?&]v=)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  function getActiveQueueItemImgSrc() {
    const playingItem = document.querySelector(
      'ytmusic-player-queue #contents ytmusic-player-queue-item[play-button-state="playing"], ' +
      'ytmusic-player-queue #contents ytmusic-player-queue-item[play-button-state="loading"]'
    );
    if (playingItem) {
      const img = playingItem.querySelector('img');
      const src = img?.getAttribute('src') || img?.src || '';
      if (src && !src.startsWith('data:')) return src;
    }
    const selectedItem = document.querySelector(
      'ytmusic-player-queue #contents ytmusic-player-queue-item[selected]'
    );
    if (selectedItem) {
      const img = selectedItem.querySelector('img');
      const src = img?.getAttribute('src') || img?.src || '';
      if (src && !src.startsWith('data:')) return src;
    }
    return '';
  }

  function getPlayerBarImgSrc() {
    const barImg = document.querySelector(
      'ytmusic-player-bar .thumbnail-image-wrapper img, ytmusic-player-bar yt-img-shadow.image img, ytmusic-player-bar img.image'
    );
    const src = barImg?.getAttribute('src') || barImg?.src || '';
    return src && !src.startsWith('data:') ? src : '';
  }

  function getHighResArtworkUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl;
    if (isSquareCoverUrl(url)) {
      url = url.replace(/=w\d+-h\d+[^=]*$/, '=w1200-h1200-l90-rj');
      url = url.replace(/=s\d+[^=]*$/, '=s1200');
    } else if (url.includes('ytimg.com')) {
      // Eliminar parámetros ?sqp=... en miniaturas de video de ytimg.com porque aplican
      // un recorte 4:3 del lado del servidor que provoca zoom adicional dentro del contenedor 16:9
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

    const activeQueueSrc = getActiveQueueItemImgSrc();
    const barSrc = getPlayerBarImgSrc();
    const titleLink = document.querySelector(
      'ytmusic-player-bar .title a[href*="watch?v="], ytmusic-player-bar a[href*="watch?v="]'
    );
    const domVid =
      extractVideoIdFromUrl(activeQueueSrc) ||
      extractVideoIdFromUrl(barSrc) ||
      extractVideoIdFromUrl(titleLink?.href || '');

    if (!vid && domVid) {
      vid = domVid;
    }

    const key = `${vid}|${hasVideoMode}`;
    if (vid && key === cachedTrackDetails.cacheKey && cachedTrackDetails.mvType) {
      return cachedTrackDetails;
    }

    let mvType = '';
    let bestThumb = '';
    let isVerified = false;
    try {
      const vd = p?.getPlayerResponse?.()?.videoDetails;
      // Solo usar videoDetails si su videoId coincide estrictamente con el video_id activo
      // (evita que getPlayerResponse() devuelva la primera canción del Mix al avanzar en la cola)
      if (vd && vid && vd.videoId === vid && (!domVid || vd.videoId === domVid)) {
        mvType = vd.musicVideoType || '';
        isVerified = true;
        const thumbs = vd.thumbnail?.thumbnails;
        if (Array.isArray(thumbs) && thumbs.length > 0) {
          const best = thumbs.reduce((a, b) =>
            (b.width || 0) * (b.height || 0) >= (a.width || 0) * (a.height || 0) ? b : a
          );
          if (best?.url) bestThumb = getHighResArtworkUrl(best.url);
        }
      }
    } catch (_) {}

    const result = {
      cacheKey: isVerified ? `${vid}|${hasVideoMode}` : '',
      videoId: vid,
      mvType,
      bestThumb,
    };

    if (isVerified) {
      cachedTrackDetails = result;
    }
    return result;
  }

  /**
   * Busca la carátula cuadrada de álbum (googleusercontent.com) verificando primero
   * en el ítem activo de la cola y la barra inferior que la pista actual realmente tenga carátula cuadrada.
   */
  function getSquareAlbumCoverUrl() {
    const activeQueueSrc = getActiveQueueItemImgSrc();
    const barSrc = getPlayerBarImgSrc();

    // 1. Si el ítem actualmente en reproducción en la cola o la barra inferior tienen carátula cuadrada
    if (isSquareCoverUrl(activeQueueSrc)) {
      return getHighResArtworkUrl(activeQueueSrc);
    }
    if (isSquareCoverUrl(barSrc)) {
      return getHighResArtworkUrl(barSrc);
    }

    // Si tanto la barra inferior como el ítem activo de la cola tienen miniatura de video (ytimg.com),
    // la pista actual es un video sin carátula cuadrada: retornar '' de inmediato para nunca mostrar la anterior
    if (activeQueueSrc.includes('ytimg.com') || barSrc.includes('ytimg.com')) {
      return '';
    }

    // 2. Respuesta verificada del reproductor (#movie_player) para el videoId actual
    const { videoId, mvType, bestThumb } = getTrackDetailsCached();
    if (isSquareCoverUrl(bestThumb)) {
      return bestThumb;
    }

    const ytPlayer = document.querySelector('ytmusic-player');
    const page = document.querySelector('ytmusic-player-page');
    const avToggle = document.querySelector('ytmusic-av-toggle');
    const canSwitch = Boolean(
      avToggle && !avToggle.hasAttribute('toggle-disabled') && !avToggle.toggleDisabled
    );
    const isVideoMode =
      (mvType && mvType !== 'MUSIC_VIDEO_TYPE_ATV') ||
      Boolean(ytPlayer?.videoMode_) ||
      Boolean(ytPlayer?.hasAttribute('video-mode')) ||
      Boolean(page?.hasAttribute('video-mode'));

    if (videoId && isVideoMode && !canSwitch) {
      return '';
    }

    return '';
  }

  function getBestTrackThumbnailUrl() {
    // Prioridad 1: Carátula cuadrada oficial de la canción (si existe)
    const squareCover = getSquareAlbumCoverUrl();
    if (squareCover) return squareCover;

    // Prioridad 2: Miniatura del video en alta resolución (para videos sin carátula)
    const { videoId, bestThumb } = getTrackDetailsCached();
    if (bestThumb && !isSquareCoverUrl(bestThumb) && !failedThumbUrls.has(bestThumb)) {
      return bestThumb;
    }

    if (videoId) {
      const sdUrl = `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`;
      if (!failedThumbUrls.has(sdUrl)) {
        return sdUrl;
      }
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    const activeQueueSrc = getActiveQueueItemImgSrc();
    if (activeQueueSrc) return getHighResArtworkUrl(activeQueueSrc);

    const barSrc = getPlayerBarImgSrc();
    if (barSrc) return getHighResArtworkUrl(barSrc);

    return '';
  }

  function ensureSongImageObserver() {
    const nativeImg = document.querySelector('ytmusic-player-page #song-image img');
    if (!nativeImg || nativeImg === observedSongImg) return;

    if (songImgObserver) {
      songImgObserver.disconnect();
    }
    observedSongImg = nativeImg;

    nativeImg.addEventListener('load', () => {
      const shadow = nativeImg.closest('yt-img-shadow');
      if (shadow) {
        shadow.classList.remove('empty');
        shadow.setAttribute('loaded', '');
      }
    });

    nativeImg.addEventListener('error', () => {
      const currentSrc = nativeImg.getAttribute('src') || '';
      if (currentSrc) {
        failedThumbUrls.add(currentSrc);
      }
      if (!document.body.classList.contains('zumic-mode-song')) return;
      const { videoId } = getTrackDetailsCached();
      const fallbackUrl = videoId
        ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        : getPlayerBarImgSrc() || getActiveQueueItemImgSrc();
      if (fallbackUrl && currentSrc !== fallbackUrl) {
        nativeImg.removeAttribute('srcset');
        nativeImg.src = fallbackUrl;
      }
    });

    songImgObserver = new MutationObserver(() => {
      if (!document.body.classList.contains('zumic-mode-song')) return;
      const src = nativeImg.getAttribute('src') || '';
      const best = getBestTrackThumbnailUrl();
      if (!best) return;

      const shadow = nativeImg.closest('yt-img-shadow');
      if (src !== best) {
        nativeImg.removeAttribute('srcset');
        nativeImg.src = best;
      }
      if (shadow && (shadow.classList.contains('empty') || !shadow.hasAttribute('loaded'))) {
        shadow.classList.remove('empty');
        shadow.setAttribute('loaded', '');
      }
    });
    songImgObserver.observe(nativeImg, { attributes: true, attributeFilter: ['src'] });
    const parentShadow = nativeImg.closest('yt-img-shadow');
    if (parentShadow) {
      songImgObserver.observe(parentShadow, { attributes: true, attributeFilter: ['class', 'loaded'] });
    }
  }

  function updateCustomArtwork() {
    ensureSongImageObserver();
    const nativeImg = document.querySelector('ytmusic-player-page #song-image img');
    if (!nativeImg) return;

    const bestUrl = getBestTrackThumbnailUrl();
    if (!bestUrl) return;

    const currentSrc = nativeImg.getAttribute('src') || '';
    if (currentSrc !== bestUrl) {
      nativeImg.removeAttribute('srcset');
      nativeImg.src = bestUrl;
    }

    const imgShadow = document.querySelector('ytmusic-player-page #song-image yt-img-shadow');
    if (imgShadow) {
      imgShadow.classList.remove('empty');
      imgShadow.setAttribute('loaded', '');
    }

    updateDynamicBackground(bestUrl);
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
    const barSrc = getPlayerBarImgSrc();
    const activeQueueSrc = getActiveQueueItemImgSrc();

    let isATV;
    if (mvType) {
      isATV = mvType === 'MUSIC_VIDEO_TYPE_ATV';
    } else if (barSrc.includes('ytimg.com') || activeQueueSrc.includes('ytimg.com')) {
      isATV = false;
    } else if (isSquareCoverUrl(barSrc) || isSquareCoverUrl(activeQueueSrc)) {
      isATV = true;
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
    if (videoId && noSongTrackIds.has(videoId) && !isATV) {
      canSwitch = false;
    }

    const hasVideo = !isATV || canSwitch;
    return { videoId, mvType, isATV, canSwitch, hasVideo, avToggle };
  }

  function isAnyPopupMenuOpen() {
    const openDropdown = document.querySelector(
      'tp-yt-iron-dropdown:not([aria-hidden="true"]), ' +
      'tp-yt-paper-dialog:not([aria-hidden="true"]), ' +
      'ytmusic-menu-popup-renderer, ' +
      'ytd-multi-page-menu-renderer'
    );
    if (!openDropdown) return false;
    const rect = openDropdown.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  /**
   * Dispara el cambio nativo en <ytmusic-av-toggle> cuando la pista tiene
   * tanto versión Canción (ATV) como versión Video (OMV).
   */
  function triggerNativeAVSwitch(targetMode) {
    if (isAnyPopupMenuOpen()) return false;
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
      const autoSwitchKey = `${videoId}|${mode}`;
      const alreadyPending =
        pendingAVSwitch &&
        pendingAVSwitch.targetMode === mode &&
        pendingAVSwitch.videoId === videoId;
      const alreadyAttemptedAuto = Boolean(videoId && attemptedAutoSwitchKeys.has(autoSwitchKey));

      if (fromUserClick || (!alreadyPending && !alreadyAttemptedAuto && videoId)) {
        if (pendingAVSwitch?.timer) clearTimeout(pendingAVSwitch.timer);
        if (!fromUserClick && videoId) {
          attemptedAutoSwitchKeys.add(autoSwitchKey);
        }
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
            } else if (mode === 'song' && !afterState.isATV && afterState.videoId === startVideoId) {
              noSongTrackIds.add(startVideoId);
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
    } else if (showVideo) {
      try {
        const p = document.querySelector('#movie_player');
        p?.setInternalSize?.();
      } catch (_) {}
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

  function getSwitcherContainer() {
    const page = document.querySelector('ytmusic-player-page');
    if (!page) return null;
    const isMobileLayout = page.hasAttribute('is-mweb-modernization-enabled');
    if (isMobileLayout) {
      const topBarAv = page.querySelector('#top-player-bar #av-id, .top-player-bar #av-id');
      if (topBarAv) return topBarAv;
    }
    return (
      page.querySelector('#main-panel #av-id') ||
      page.querySelector('#av-id') ||
      page.querySelector('#main-panel')
    );
  }

  function setupSongVideoSwitcher() {
    const container = getSwitcherContainer();
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
    setVolume(vol) {
      return setVolume(vol);
    },
    getVolume() {
      return getCurrentVolume();
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
    setupVolumeWheelControl();
    restoreSavedVolume();
    setupProgressBarHitbox();

    // Inicializar fondo dinámico si ya hay carátula disponible
    setTimeout(() => {
      const initialThumb = getBestTrackThumbnailUrl();
      if (initialThumb) updateDynamicBackground(initialThumb);
    }, 1200);

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

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        setupSongVideoSwitcher();
        applyAVMode(currentAVMode, false);
        if (document.body?.classList.contains('zumic-mode-song')) {
          updateCustomArtwork();
        }
      }, 120);
    });

    let lastAVSignature = '';
    setInterval(() => {
      const container = getSwitcherContainer();
      if (!container) return;
      const switcher = document.getElementById('zumic-av-switcher');
      if (!switcher || switcher.parentElement !== container) {
        setupSongVideoSwitcher();
        return;
      }

      const page = document.querySelector('ytmusic-player-page');
      const isMobileLayout = Boolean(page?.hasAttribute('is-mweb-modernization-enabled'));
      const { videoId, mvType, isATV, canSwitch } = getNativeAVState();
      const bestThumb = getBestTrackThumbnailUrl();
      const signature = `${videoId}|${mvType}|${isATV}|${canSwitch}|${bestThumb}|${isMobileLayout}`;
      if ((videoId || bestThumb) && signature !== lastAVSignature) {
        lastAVSignature = signature;
        applyAVMode(currentAVMode, false);
        setTimeout(() => applyAVMode(currentAVMode, false), 450);
      } else if (document.body?.classList.contains('zumic-mode-song') && bestThumb) {
        const nativeImg = document.querySelector('ytmusic-player-page #song-image img');
        const imgShadow = document.querySelector('ytmusic-player-page #song-image yt-img-shadow');
        if (
          nativeImg &&
          (!nativeImg.getAttribute('src') ||
            nativeImg.getAttribute('src') !== bestThumb ||
            imgShadow?.classList.contains('empty') ||
            !imgShadow?.hasAttribute('loaded'))
        ) {
          updateCustomArtwork();
        }
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
