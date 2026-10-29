# Third-party software

This package vendors **Three.js 0.180.0** under its MIT license. It is pinned deliberately; it is not claimed to be the latest release. No CDN is contacted at runtime.

Upstream project: https://github.com/mrdoob/three.js/tree/r180

Files retrieved from the version-pinned npm distribution:

- `vendor/three.module.min.js` — https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js
- `vendor/three.core.min.js` — https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.min.js
- `vendor/OrbitControls.js` — https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js
- `vendor/STLLoader.js` — https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/STLLoader.js
- `vendor/LICENSE.txt` — https://cdn.jsdelivr.net/npm/three@0.180.0/LICENSE

In OrbitControls and STLLoader, only the bare import `from 'three'` was changed to `from './three.module.min.js'`. This lets the page and worker load the same included library without a package manager, import map, or build step. The two minified Three.js build files are unmodified.

Retain `vendor/LICENSE.txt` when redistributing. The original viewer files and generated demo geometry use the top-level MIT `LICENSE`.
