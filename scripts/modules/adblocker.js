/**
 * Módulo de Bloqueo de Anuncios y Diálogos de Inactividad ("¿Sigues ahí?")
 */

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
