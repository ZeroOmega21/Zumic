/**
 * Módulo de Modo Ahorro / Solo Audio (Suspensión de video y efectos GPU)
 */

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

function initPowerSaverButton() {
  setupAudioOnlyButton();
  const saverBtnInterval = setInterval(() => {
    if (document.getElementById('zumic-saver-btn')) {
      clearInterval(saverBtnInterval);
    } else {
      setupAudioOnlyButton();
    }
  }, 1500);
}
