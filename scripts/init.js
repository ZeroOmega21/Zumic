/**
 * Zumic — Punto de entrada y orquestador del Frontend inyectado en la WebView
 *
 * Coordina los módulos:
 *  - styles.css        (Tema visual, transiciones y layouts responsivos)
 *  - presence.js       (Extracción de metadatos y sincronización con Discord RPC)
 *  - adblocker.js      (Silenciado, aceleración y salto de anuncios)
 *  - background.js     (Fondo difuminado dinámico de carátula)
 *  - volume.js         (Control de volumen con rueda de ratón, HUD y hitbox de progreso)
 *  - power-saver.js    (Modo ahorro / solo audio)
 *  - av-switcher.js    (Conmutador Canción / Video y carátulas de alta resolución)
 */

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

// ─── Inyección de estilos visuales ────────────────────────────────────────
function injectCustomStyles() {
  const styleId = 'zumic-custom-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = typeof ZUMIC_STYLES === 'string' ? ZUMIC_STYLES : '';

  const root = document.documentElement;
  if (root) {
    root.style.setProperty('--zumic-blur', CONFIG.BLUR_AMOUNT);
    root.style.setProperty('--zumic-bg-opacity', String(CONFIG.BACKGROUND_OPACITY));
    root.style.setProperty('--zumic-bg-image', CONFIG.BACKGROUND_IMAGE || 'none');
  }

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
      if (v.paused) v.play();
      else v.pause();
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

  // Inyectar botón de ahorro en la barra de navegación
  initPowerSaverButton();

  // Inyectar y sincronizar selector [ Canción | Video ]
  initAVSwitcherWatcher();

  // Polling de respaldo para progreso de reproducción
  startProgressPolling();

  log('Zumic Init listo.');
}

// Diferir la inicialización hasta que la página termine su carga inicial
// para no competir con la hidratación de Polymer de YouTube Music
if (document.readyState === 'complete') {
  setTimeout(bootstrap, 150);
} else {
  window.addEventListener('load', () => setTimeout(bootstrap, 150), { once: true });
}
