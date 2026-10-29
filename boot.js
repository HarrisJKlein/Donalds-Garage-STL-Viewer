// Keep a useful message if module loading or WebGL setup fails.
import('./app.js?v=20261029-2').catch((error) => {
  console.error('Viewer startup failed:', error);
  const status = document.getElementById('status');
  status.hidden = false;
  status.classList.add('is-error');
  if (location.protocol === 'file:') {
    status.textContent = 'Open this viewer through GitHub Pages or a local HTTP server. Double-clicking index.html cannot load its modules.';
  } else if (error.code === 'WEBGL_UNAVAILABLE') {
    status.textContent = 'WebGL 2 graphics could not start. In Chrome, enable graphics acceleration in Settings → System, relaunch Chrome, and reload this page.';
  } else {
    status.textContent = `The viewer could not load its files. Refresh the page to get the latest version. Details: ${error.message || 'Unknown startup error'}`;
  }
  document.getElementById('viewport').setAttribute('aria-busy', 'false');
  const viewportMessage = document.getElementById('viewport-message');
  viewportMessage.hidden = false;
  viewportMessage.textContent = '3D preview unavailable. See the message above.';
});
