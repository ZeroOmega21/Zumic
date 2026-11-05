/**
 * Módulo de Fondo Difuminado Dinámico basado en la Carátula Actual
 */

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
