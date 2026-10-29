import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { MAX_FILE_BYTES } from './stl-validation.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const status = $('status');
const fileInput = $('file-input');
const modelButtons = ['fit-button', 'wireframe-button', 'rotate-button', 'image-button', 'clear-button'];
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x222222, 10, 22);
const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 150);
camera.up.set(0, 0, 1); // Common CAD convention: Z is up. Dimensions retain the original XYZ order.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x222222, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', '3D model. Drag to orbit, scroll or pinch to zoom, right-drag to pan. Keyboard: arrows to orbit, plus and minus to zoom, Home to fit.');
canvas.setAttribute('aria-describedby', 'interaction-help');
viewport.prepend(canvas);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false; // Render only when something changes; keep idle embeds inexpensive.
controls.autoRotateSpeed = 1.25;
controls.minDistance = 0.15;
controls.maxDistance = 40;
controls.target.set(0, 0, 0);
controls.update();

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x555555, 2);
hemisphere.position.set(0, 0, 5);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(-3, -4, 7);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 1);
rimLight.position.set(4, 3, 3);
scene.add(rimLight);
const grid = new THREE.GridHelper(14, 28, 0x666666, 0x555555);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true;
grid.material.opacity = 0.25;
scene.add(grid);

let mesh = null;
let loadedName = '';
let worker = null;
let loadVersion = 0;
let parsingTimeout = null;
let animationFrame = null;
let previousFrame = 0;
let dragDepth = 0;
let inView = true;
let contextLost = false;

function render() {
  if (!contextLost) renderer.render(scene, camera);
}

function message(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

function setBusy(busy) {
  viewport.setAttribute('aria-busy', String(busy));
  $('clear-button').disabled = !busy && !mesh;
}

function modelControlsEnabled(enabled) {
  for (const id of modelButtons) $(id).disabled = !enabled;
}

function releaseMesh() {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh = null;
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

function setAutoRotate(active) {
  controls.autoRotate = active;
  $('rotate-button').setAttribute('aria-pressed', String(active));
  updateAnimation();
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
  controls.update();
  render();
}

function formatNumber(value) {
  if (value === 0) return '0';
  return Math.abs(value) < 0.001 || Math.abs(value) >= 1e6
    ? value.toExponential(3)
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function showModel(positions, file, isSample) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) {
    geometry.dispose();
    throw new Error('This model has no visible size. Choose a nonempty mesh.');
  }
  // Normalize the preview only. Never modify the user's source file or reported dimensions.
  const scale = 2 / largest;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - center.x) * scale;
    positions[i + 1] = (positions[i + 1] - center.y) * scale;
    positions[i + 2] = (positions[i + 2] - center.z) * scale;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  releaseMesh();
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  grid.position.z = -size.z * scale / 2 - 0.035;
  loadedName = file.name;
  $('filename').textContent = file.name;
  $('filename').title = file.name;
  $('triangle-count').textContent = (positions.length / 9).toLocaleString();
  $('file-size').textContent = formatBytes(file.size);
  $('dimensions').textContent = `${formatNumber(size.x)} × ${formatNumber(size.y)} × ${formatNumber(size.z)}`;
  $('sample-tag').hidden = !isSample;
  $('viewport-message').hidden = true;
  $('wireframe-button').setAttribute('aria-pressed', 'false');
  setAutoRotate(false);
  modelControlsEnabled(true);
  fitView();
  message(isSample ? 'Demo model loaded. Choose your own STL to replace it.' : 'Ready to explore. Preview only — your file has not been submitted.');
}

async function loadFile(file, isSample = false) {
  const version = ++loadVersion;
  cancelParsing();
  setBusy(false);
  if (!file || !/\.stl$/i.test(file.name)) return message('Choose a file ending in .stl. Other model formats are not supported.', true);
  if (!file.size) return message('This file is empty. Choose a complete STL export.', true);
  if (file.size > MAX_FILE_BYTES) return message('This file exceeds 50 MiB. Export a lower-resolution STL and try again.', true);
  setBusy(true);
  message(`Reading ${file.name} on your device…`);
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
        showModel(data.positions, file, isSample);
      } catch (error) {
        message(error.message || 'This model could not be displayed. Try another STL.', true);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail('The STL reader could not start. Reload and check that all viewer files, including stl-worker.js, were published.');
    };
    worker.onmessageerror = () => fail('The model could not be read. Try another STL.');
    parsingTimeout = setTimeout(() => fail('This file took too long to read. Export a simpler STL and try again.'), 30000);
    worker.postMessage(buffer, [buffer]);
  } catch (error) {
    if (version !== loadVersion) return;
    cancelParsing();
    setBusy(false);
    message('This file could not be opened. Check file access and try again.', true);
    console.error(error);
  }
}

async function loadDemo() {
  const version = ++loadVersion;
  cancelParsing();
  setBusy(true);
  message('Opening the included demo model…');
  try {
    const response = await fetch(new URL('./samples/garage-demo.stl', import.meta.url));
    if (!response.ok) throw new Error('Demo file missing');
    const buffer = await response.arrayBuffer();
    if (version !== loadVersion) return;
    await loadFile(new File([buffer], 'garage-demo.stl', { type: 'application/octet-stream' }), true);
  } catch {
    if (version !== loadVersion) return;
    setBusy(false);
    message('The demo could not be opened. You can still choose your own STL.', true);
    $('viewport-message').textContent = 'Choose or drop an STL file.';
  }
}

function clearModel() {
  ++loadVersion;
  cancelParsing();
  setAutoRotate(false);
  releaseMesh();
  loadedName = '';
  fileInput.value = '';
  $('filename').textContent = 'No model loaded';
  $('filename').title = 'No model loaded';
  for (const id of ['triangle-count', 'file-size', 'dimensions']) $(id).textContent = '—';
  $('sample-tag').hidden = true;
  $('viewport-message').textContent = 'Choose or drop an STL file.';
  $('viewport-message').hidden = false;
  $('wireframe-button').setAttribute('aria-pressed', 'false');
  modelControlsEnabled(false);
  setBusy(false);
  message('Preview cleared. Choose an STL or try the demo.');
  render();
}

function acceptFiles(files) {
  if (files.length !== 1) {
    ++loadVersion;
    cancelParsing();
    setBusy(false);
    return message('Choose one STL at a time. Drop a single .stl file to preview it.', true);
  }
  loadFile(files[0]);
}

fileInput.addEventListener('click', () => { fileInput.value = ''; }); // Allow choosing the same file again.
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) acceptFiles(fileInput.files);
});
$('demo-button').addEventListener('click', loadDemo);
$('fit-button').addEventListener('click', () => fitView());
$('clear-button').addEventListener('click', clearModel);
$('wireframe-button').addEventListener('click', () => {
  if (!mesh) return;
  mesh.material.wireframe = !mesh.material.wireframe;
  $('wireframe-button').setAttribute('aria-pressed', String(mesh.material.wireframe));
  render();
});
$('rotate-button').addEventListener('click', () => setAutoRotate(!controls.autoRotate));
$('image-button').addEventListener('click', () => {
  if (!mesh) return;
  render(); // Capture immediately, without preserveDrawingBuffer or a server request.
  canvas.toBlob((blob) => {
    if (!blob) return message('Image could not be saved. Try again.', true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${loadedName.replace(/\.stl$/i, '')}-preview.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    message('Preview image saved locally. Your STL has not been submitted.');
  }, 'image/png');
});

function showDrop(active) {
  $('dropzone').classList.toggle('is-dragging', active);
  $('drop-overlay').hidden = !active;
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
    case 'Home': event.preventDefault(); fitView(); return;
    default: return;
  }
  event.preventDefault();
  sphere.makeSafe();
  sphere.radius = THREE.MathUtils.clamp(sphere.radius, controls.minDistance, controls.maxDistance);
  offset.setFromSpherical(sphere);
  camera.position.set(offset.x, -offset.z, offset.y).add(controls.target);
  controls.update();
  render();
});

controls.addEventListener('change', render);
const resizeObserver = new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (mesh) fitView(true);
  else render();
});
resizeObserver.observe(viewport);
const intersectionObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; updateAnimation(); });
intersectionObserver.observe(viewport);
document.addEventListener('visibilitychange', updateAnimation);
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  updateAnimation();
  modelControlsEnabled(false);
  $('viewport-message').hidden = false;
  $('viewport-message').textContent = 'Graphics paused. Waiting for your browser to restore the preview…';
  message('The browser paused graphics. If the preview does not recover, reload this page.', true);
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  $('viewport-message').hidden = Boolean(mesh);
  if (!mesh) $('viewport-message').textContent = 'Choose or drop an STL file.';
  modelControlsEnabled(Boolean(mesh));
  message('Graphics restored. Your STL has not been submitted.');
  render();
  updateAnimation();
});
window.addEventListener('pagehide', () => {
  ++loadVersion;
  cancelParsing();
  setBusy(false);
  setAutoRotate(false);
});
fileInput.disabled = false;
$('demo-button').disabled = false;
loadDemo();
