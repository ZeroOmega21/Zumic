/**
 * Módulo de Presencia (Discord RPC) y Extracción de Metadatos
 *
 * Responsabilidades:
 *  - Extraer título, artista, álbum, carátula, progreso y URL desde mediaSession y el DOM
 *  - Observar cambios de pista y estado de reproducción (<video>, DOM y mediaSession)
 *  - Enviar actualizaciones al backend Rust vía Tauri IPC
 */

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

/** Inicia el polling de respaldo para actualizar el tiempo de reproducción */
function startProgressPolling() {
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
}
