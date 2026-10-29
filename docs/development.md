# Local development and publishing

This static site needs no build or package installation. Serve the checkout over HTTP:

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

Run the algorithm tests with `node --test tests/*.test.mjs`. In the prepared cloud environment, `python3 tests/browser-startup.py` uses installed Python Playwright and `/usr/bin/chromium` to check startup, actual STL loading, stale browser caches, a missing optional module, and a graphics initialization failure.

## Keep release assets together

GitHub Pages and browser caches may retain older JavaScript after a deployment. The bootstrap, styles, application modules and workers use a shared `?v=20261029-3` release tag so a fresh page loads a compatible set of files. When changing dependencies or exports, bump the tag together in `index.html`, `boot.js`, `app.js`, `plate-previews.js`, `stl-worker.js` and `support-worker.js`. Leave the unchanged, pinned vendored Three.js files alone.

Build-plate images load as an optional module. An image-module download failure must leave the main STL viewer and model information working. `boot.js` distinguishes a graphics initialization error from a required script/module loading failure and shows the underlying loading error for diagnosis.
