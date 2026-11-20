export function compatibilityUrl(href) {
  const url = new URL(href);
  url.searchParams.set('quality', 'low');
  url.searchParams.set('recovered', '1');
  return url.href;
}

export function bindGraphicsRecovery(canvas, { lowDetail, pause, fallback, failure }) {
  let handled = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (handled) return;
    handled = true;
    pause();
    if (lowDetail) failure();
    else fallback();
  });
}
