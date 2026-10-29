import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { MAX_FILE_BYTES } from './stl-validation.js';
import { PRINTERS, printerFit, formatDimension, formatFileSize } from './model-info.js';
import { createViewRestore } from './view-restore.js';

const fileInput = document.getElementById('file-input');
const viewport = document.getElementById('viewport');
const status = document.getElementById('status');
const viewportMessage = document.getElementById('viewport-message');
const fitButton = document.getElementById('fit-button');
const autoRestoreButton = document.getElementById('auto-restore-button');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 150);
camera.up.set(0, 0, 1);
camera.position.set(3.2, -4.8, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x171717, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'Rotating STL preview. Drag to orbit; scroll or pinch to zoom. Space pauses rotation, arrows orbit, plus and minus zoom, Home fits the model.');
viewport.prepend(canvas);

const controls = new OrbitControls(camera, canvas);
controls.autoRotate = true;
controls.autoRotateSpeed = 1.25;
controls.minDistance = 0.15;
controls.maxDistance = 40;
const hemisphere = new THREE.HemisphereLight(0xffffff, 0x555555, 2);
hemisphere.position.set(0, 0, 5);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(-3, -4, 7);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 1);
rimLight.position.set(4, 3, 3);
scene.add(rimLight);

let mesh = null;
let worker = null;
let loadVersion = 0;
let parsingTimeout = null;
let animationFrame = null;
let previousFrame = 0;
let dragDepth = 0;
let inView = true;
let contextLost = false;
const viewRestore = createViewRestore(() => {
  if (!contextLost) fitView();
});
controls.addEventListener('start', () => viewRestore.start());
controls.addEventListener('end', () => viewRestore.end());

function render() {
  if (!contextLost) renderer.render(scene, camera);
}

function message(text = '', isError = false) {
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('is-error', isError);
}

function setBusy(busy) {
  viewport.setAttribute('aria-busy', String(busy));
}

function cancelParsing() {
  worker?.terminate();
  worker = null;
  clearTimeout(parsingTimeout);
  parsingTimeout = null;
}

function updateAnimation() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  previousFrame = 0;
  if (!mesh || !controls.autoRotate || document.hidden || !inView || contextLost) return;
  const animate = (now) => {
    const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.1) : 0;
    previousFrame = now;
    controls.update(delta);
    render();
    animationFrame = requestAnimationFrame(animate);
  };
  animationFrame = requestAnimationFrame(animate);
}

function fitView(keepDirection = false) {
  if (!mesh) return;
  const radius = mesh.geometry.boundingSphere.radius;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.16;
  const direction = keepDirection
    ? camera.position.clone().sub(controls.target).normalize()
    : new THREE.Vector3(3.2, -4.8, 3.5).normalize();
  controls.target.set(0, 0, 0);
  camera.position.copy(direction.multiplyScalar(distance));
  controls.maxDistance = Math.max(40, distance * 4);
  // Fit/reset must restore a consistent pose even when rotation is enabled.
  const rotating = controls.autoRotate;
  controls.autoRotate = false;
  controls.update();
  controls.autoRotate = rotating;
  render();
}

function updateModelInfo(positions, size, file) {
  document.getElementById('model-name').textContent = file.name;
  document.getElementById('triangle-count').textContent = (positions.length / 9).toLocaleString();
  document.getElementById('file-size').textContent = formatFileSize(file.size);
  const dimensions = [size.x, size.y, size.z];
  document.getElementById('dimensions').textContent = `${dimensions.map(formatDimension).join(' × ')} mm`;
  const rows = PRINTERS.map(({ name, volume }) => {
    const result = printerFit(dimensions, volume);
    const row = document.createElement('tr');
    const printer = document.createElement('th');
    printer.scope = 'row';
    printer.textContent = name;
    const buildVolume = document.createElement('span');
    buildVolume.className = 'build-volume';
    buildVolume.textContent = volume.join(' × ');
    printer.append(buildVolume);
    const fit = document.createElement('td');
    fit.className = `fit-result ${result}`;
    fit.textContent = { oriented: 'Fits as oriented', reorient: 'Fits if reoriented', exceeds: 'Exceeds checked bounds' }[result];
    row.append(printer, fit);
    return row;
  });
  document.getElementById('printer-fit').replaceChildren(...rows);
  document.getElementById('model-info').hidden = false;
}

function showModel(positions, file) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) {
    geometry.dispose();
    throw new Error('This STL has no visible geometry.');
  }
  // Normalize the preview only. The selected file is never modified or uploaded.
  const scale = 2 / largest;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - center.x) * scale;
    positions[i + 1] = (positions[i + 1] - center.y) * scale;
    positions[i + 2] = (positions[i + 2] - center.z) * scale;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  viewportMessage.hidden = true;
  controls.autoRotate = true;
  viewRestore.cancel();
  fitView();
  updateModelInfo(positions, size, file);
  fitButton.disabled = contextLost;
  message();
  updateAnimation();
}

async function loadFile(file) {
  const version = ++loadVersion;
  cancelParsing();
  setBusy(false);
  if (!file || !/\.stl$/i.test(file.name)) return message('Choose an .stl file.', true);
  if (!file.size) return message('This file is empty.', true);
  if (file.size > MAX_FILE_BYTES) return message('Choose an STL smaller than 50 MiB.', true);
  setBusy(true);
  message('Loading…');
  try {
    const buffer = await file.arrayBuffer();
    if (version !== loadVersion) return;
    worker = new Worker(new URL('./stl-worker.js', import.meta.url), { type: 'module' });
    const fail = (text) => {
      if (version !== loadVersion) return;
      cancelParsing();
      setBusy(false);
      message(text, true);
    };
    worker.onmessage = ({ data }) => {
      if (version !== loadVersion) return;
      cancelParsing();
      setBusy(false);
      if (data.error) return message(data.error, true);
      try {
        showModel(data.positions, file);
        // Show dropped filenames in the same native picker used for selection.
        const selection = new DataTransfer();
        selection.items.add(file);
        fileInput.files = selection.files;
      } catch (error) {
        message(error.message || 'This STL could not be displayed.', true);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail('The STL reader could not start. Reload and try again.');
    };
    worker.onmessageerror = () => fail('This STL could not be read.');
    parsingTimeout = setTimeout(() => fail('This STL took too long to read. Try a simpler model.'), 30000);
    worker.postMessage(buffer, [buffer]);
  } catch (error) {
    if (version !== loadVersion) return;
    cancelParsing();
    setBusy(false);
    message('This STL could not be opened.', true);
    console.error(error);
  }
}

function acceptFiles(files) {
  if (files.length !== 1) {
    ++loadVersion;
    cancelParsing();
    setBusy(false);
    return message('Choose one STL at a time.', true);
  }
  loadFile(files[0]);
}

fileInput.addEventListener('click', () => { fileInput.value = ''; });
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) acceptFiles(fileInput.files);
});
fitButton.addEventListener('click', () => { viewRestore.cancel(); fitView(); });
autoRestoreButton.addEventListener('click', () => {
  const enabled = autoRestoreButton.getAttribute('aria-pressed') !== 'true';
  autoRestoreButton.setAttribute('aria-pressed', String(enabled));
  autoRestoreButton.textContent = `Auto-reset: ${enabled ? 'on' : 'off'}`;
  viewRestore.setEnabled(enabled);
});

function showDrop(active) {
  document.getElementById('dropzone').classList.toggle('is-dragging', active);
  document.getElementById('drop-overlay').hidden = !active;
}
const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  showDrop(true);
});
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) showDrop(false);
});
window.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  showDrop(false);
  acceptFiles(event.dataTransfer.files);
});
window.addEventListener('blur', () => { dragDepth = 0; showDrop(false); });

canvas.addEventListener('keydown', (event) => {
  if (!mesh) return;
  if (event.code === 'Space') {
    event.preventDefault();
    controls.autoRotate = !controls.autoRotate;
    updateAnimation();
    viewRestore.adjusted();
    return;
  }
  const offset = camera.position.clone().sub(controls.target);
  const sphere = new THREE.Spherical().setFromVector3(new THREE.Vector3(offset.x, offset.z, -offset.y));
  const step = Math.PI / 18;
  switch (event.key) {
    case 'ArrowLeft': sphere.theta -= step; break;
    case 'ArrowRight': sphere.theta += step; break;
    case 'ArrowUp': sphere.phi -= step; break;
    case 'ArrowDown': sphere.phi += step; break;
    case '+': case '=': sphere.radius /= 1.15; break;
    case '-': case '_': sphere.radius *= 1.15; break;
    case 'Home': event.preventDefault(); viewRestore.cancel(); fitView(); return;
    default: return;
  }
  event.preventDefault();
  sphere.makeSafe();
  sphere.radius = THREE.MathUtils.clamp(sphere.radius, controls.minDistance, controls.maxDistance);
  offset.setFromSpherical(sphere);
  camera.position.set(offset.x, -offset.z, offset.y).add(controls.target);
  controls.update();
  render();
  viewRestore.adjusted();
});

controls.addEventListener('change', render);
new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (mesh) fitView(true);
  else render();
}).observe(viewport);
new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; updateAnimation(); }).observe(viewport);
document.addEventListener('visibilitychange', updateAnimation);
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  viewRestore.cancel();
  fitButton.disabled = true;
  updateAnimation();
  viewportMessage.hidden = false;
  viewportMessage.textContent = 'Preview paused';
  message('Graphics paused. Reload if the preview does not recover.', true);
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  fitButton.disabled = !mesh;
  viewportMessage.hidden = true;
  message();
  render();
  updateAnimation();
});
window.addEventListener('pagehide', () => {
  viewRestore.cancel();
  ++loadVersion;
  cancelParsing();
  setBusy(false);
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
});
window.addEventListener('pageshow', updateAnimation);
fileInput.disabled = false;
autoRestoreButton.disabled = false;
