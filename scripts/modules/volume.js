/**
 * Módulo de Control de Volumen (Rueda del Ratón + HUD Flotante) y Hitbox de Barra de Progreso
 */

let volumeHudTimer = null;
let hasRestoredVolume = false;

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
