/**
 * Módulo de Conmutación Canción / Video (AV Switcher) y Carátulas de Alta Resolución
 */

let currentAVMode = (function () {
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
      createAVButton('zumic-av-btn-video', 'Video', 'video')
    );
    switcher.appendChild(pill);

    container.insertBefore(switcher, container.firstChild);
    log('Switcher [ Canción | Video ] inyectado');
  }

  applyAVMode(currentAVMode, false);
}

/** Inicializa el selector Canción/Video, el listener de resize y el monitor periódico */
function initAVSwitcherWatcher() {
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
}
