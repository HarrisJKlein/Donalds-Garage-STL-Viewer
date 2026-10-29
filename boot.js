// Keep a useful message if module loading or WebGL setup fails.
import('./app.js').catch((error) => {
  console.error('Viewer startup failed:', error);
  const status = document.getElementById('status');
  status.hidden = false;
  status.classList.add('is-error');
  status.textContent = location.protocol === 'file:'
    ? 'Open this viewer through GitHub Pages or a local HTTP server. Double-clicking index.html cannot load its modules.'
    : 'The 3D viewer could not start. Try a current browser with WebGL 2 and hardware acceleration enabled, then reload. Check that the vendor folder was published.';
  document.getElementById('viewport').setAttribute('aria-busy', 'false');
  document.getElementById('viewport-message').textContent = '3D preview unavailable. See the message above.';
});
