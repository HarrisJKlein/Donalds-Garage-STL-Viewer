import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { MAX_FILE_BYTES } from './stl-validation.js?v=20261029-3';
import { PRINTERS, printerFit, formatDimension, formatFileSize, scaledDimensions, initialUnit, UNIT_MM } from './model-info.js?v=20261029-3';
import { createViewRestore } from './view-restore.js?v=20261029-3';

const fileInput = document.getElementById('file-input');
const viewport = document.getElementById('viewport');
const status = document.getElementById('status');
const viewportMessage = document.getElementById('viewport-message');
const fitButton = document.getElementById('fit-button');
const autoRestoreButton = document.getElementById('auto-restore-button');
const supportToggle = document.getElementById('support-toggle');
const supportStatus = document.getElementById('support-status');
const unitSelect = document.getElementById('unit-select');
const scalePercent = document.getElementById('scale-percent');
const printHeight = document.getElementById('print-height');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 150);
camera.up.set(0, 0, 1);
camera.position.set(3.2, -4.8, 3.5);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (cause) {
  const error = new Error('WebGL 2 graphics initialization failed.', { cause });
  error.code = 'WEBGL_UNAVAILABLE';
  throw error;
}
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
let cameraTransition = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let modelDetails = null;
let supportWorker = null;
let supportTimeout = null;
let supportResults = null;
let supportState = 'idle';
let platePreviews = null;
let autoSelectedInches = false;
const viewRestore = createViewRestore(() => {
  if (!contextLost) fitView();
});
controls.addEventListener('start', () => {
  cancelCameraTransition();
  viewRestore.start();
  updateAnimation();
});
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
  if (!mesh || (!controls.autoRotate && !cameraTransition) || document.hidden || !inView || contextLost) return;
  const animate = (now) => {
    const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.1) : 0;
    previousFrame = now;
    if (cameraTransition) {
      const transition = cameraTransition;
      transition.started ??= now;
      const progress = Math.min((now - transition.started) / 750, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const sphere = new THREE.Spherical(
        THREE.MathUtils.lerp(transition.from.radius, transition.to.radius, eased),
        THREE.MathUtils.lerp(transition.from.phi, transition.to.phi, eased),
        transition.from.theta + transition.angle * eased,
      );
      const offset = new THREE.Vector3().setFromSpherical(sphere);
      controls.target.copy(transition.target).lerp(new THREE.Vector3(), eased);
      camera.position.set(offset.x, -offset.z, offset.y).add(controls.target);
      updateControlsWithoutRotation();
      if (progress === 1) cancelCameraTransition();
    } else {
      controls.update(delta);
    }
    render();
    animationFrame = controls.autoRotate || cameraTransition ? requestAnimationFrame(animate) : null;
  };
  animationFrame = requestAnimationFrame(animate);
}

function cancelCameraTransition() {
  cameraTransition = null;
  viewport.removeAttribute('data-resetting');
}

function updateControlsWithoutRotation() {
  const rotating = controls.autoRotate;
  controls.autoRotate = false;
  controls.update();
  controls.autoRotate = rotating;
}

function fitView(keepDirection = false, animate = true) {
  if (!mesh) return;
  const radius = mesh.geometry.boundingSphere.radius;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.16;
  const direction = keepDirection
    ? camera.position.clone().sub(controls.target).normalize()
    : new THREE.Vector3(3.2, -4.8, 3.5).normalize();
  controls.maxDistance = Math.max(40, distance * 4);
  cancelCameraTransition();
  if (animate && !reducedMotion.matches && !keepDirection) {
    const offset = camera.position.clone().sub(controls.target);
    const from = new THREE.Spherical().setFromVector3(new THREE.Vector3(offset.x, offset.z, -offset.y));
    const to = new THREE.Spherical().setFromVector3(new THREE.Vector3(direction.x, direction.z, -direction.y).multiplyScalar(distance));
    const difference = to.theta - from.theta;
    cameraTransition = { from, to, angle: Math.atan2(Math.sin(difference), Math.cos(difference)), target: controls.target.clone(), started: null };
    viewport.dataset.resetting = 'true';
    updateAnimation();
    return;
  }
  controls.target.set(0, 0, 0);
  camera.position.copy(direction.multiplyScalar(distance));
  updateControlsWithoutRotation();
  render();
}

function updateModelInfo(positions, size, file) {
  document.getElementById('model-name').textContent = file.name;
  document.getElementById('triangle-count').textContent = (positions.length / 9).toLocaleString();
  document.getElementById('file-size').textContent = formatFileSize(file.size);
  const dimensions = [size.x, size.y, size.z];
  document.getElementById('unit-notice').hidden = !autoSelectedInches;
  document.getElementById('dimensions').textContent = `${dimensions.map(formatDimension).join(' × ')} mm`;
  const warning = document.getElementById('scale-warning');
  const small = Math.max(...dimensions) < 5;
  const oversized = PRINTERS.every(({ volume }) => printerFit(dimensions, volume) === 'exceeds');
  warning.hidden = !small && !oversized;
  warning.textContent = small
    ? `This model is only ${formatDimension(size.z)} mm tall and may be too small to see on the plates or estimate supports. Confirm the size, or enter your intended print height.`
    : 'This print size exceeds all four checked build volumes. Confirm the units and scale, or enter a smaller print height.';
  let previews = [];
  try {
    if (platePreviews) previews = platePreviews(mesh.geometry, dimensions, supportToggle.checked ? supportResults : null);
  } catch (error) {
    console.warn('Build plate previews unavailable:', error);
  }
  const cards = PRINTERS.map(({ name, volume }, index) => {
    const result = printerFit(dimensions, volume);
    const card = document.createElement('figure');
    card.className = 'printer-card';
    const preview = previews[index];
    if (preview) {
      const image = document.createElement('img');
      image.src = preview.image;
      image.width = 640;
      image.height = 400;
      image.alt = `${file.name} on the ${name} build plate; ${result === 'reorient' ? 'reoriented to fit' : result === 'exceeds' ? 'exceeds the checked build volume' : 'fits in the original orientation'}.`;
      if (supportToggle.checked && supportResults?.[index]?.segments.length) image.alt += ' Purple branches show an estimated tree support layout.';
      card.append(image);
    }
    const caption = document.createElement('figcaption');
    const printer = document.createElement('span');
    printer.className = 'printer-name';
    printer.textContent = name;
    const buildVolume = document.createElement('span');
    buildVolume.className = 'build-volume';
    buildVolume.textContent = `${volume.join(' × ')} mm build volume`;
    const fit = document.createElement('span');
    fit.className = `fit-result ${result}`;
    fit.textContent = { oriented: 'Fits as oriented', reorient: 'Fits if reoriented', exceeds: 'Exceeds checked bounds' }[result];
    caption.append(printer, buildVolume, fit);
    const note = document.createElement('p');
    note.className = 'orientation-note';
    note.textContent = preview
      ? `${result === 'reorient' ? 'Shown reoriented' : 'Original orientation'}: ${preview.size.map(formatDimension).join(' × ')} mm`
      : 'Image preview unavailable in this browser.';
    caption.append(note);
    if (Math.max(...dimensions) / Math.max(...volume) < 0.015) {
      const sizeNote = document.createElement('p');
      sizeNote.className = 'preview-size-note';
      sizeNote.textContent = 'The model is too small to distinguish clearly at this plate scale.';
      caption.append(sizeNote);
    }
    if (supportToggle.checked) {
      const estimate = supportResults?.[index];
      const supportNote = document.createElement('p');
      supportNote.className = 'support-caption';
      if (!estimate) supportNote.textContent = supportState === 'failed' ? 'Support estimate unavailable.' : 'Calculating support estimate…';
      else if (estimate.status === 'estimated') supportNote.textContent = estimate.tips
        ? `${estimate.reached} of ${estimate.tips} estimated contacts reach the plate.${estimate.reached < estimate.tips ? ' Check remaining overhangs in your slicer.' : ''}`
        : 'No support contacts detected at this resolution. Confirm in your slicer.';
      else supportNote.textContent = {
        outside: 'Supports not estimated: model exceeds the checked build volume.',
        complex: 'Model too complex for the quick support estimate. Use your slicer.',
        open: 'A closed mesh is needed for this support estimate. Repair it in your slicer.',
        resolution: 'Model too small or thin for the support estimate’s resolution. Check print size or use your slicer.',
      }[estimate.status] ?? 'Support estimate unavailable.';
      caption.append(supportNote);
    }
    card.append(caption);
    return card;
  });
  document.getElementById('printer-fit').replaceChildren(...cards);
  document.getElementById('model-info').hidden = false;
}

function supportSummary() {
  const count = supportResults?.filter((result) => result.status === 'estimated').length ?? 0;
  return count
    ? `Coarse support estimate ready for ${count} of 4 printers. Confirm the final layout in your slicer.`
    : 'No support layout could be estimated. Check the print size and the notes for each printer.';
}

function applyPrintSize() {
  if (!modelDetails) return;
  scalePercent.setCustomValidity('');
  printHeight.setCustomValidity('');
  const percent = Number(scalePercent.value);
  let dimensions;
  try {
    dimensions = scaledDimensions(modelDetails.rawSize.toArray(), unitSelect.value, percent);
  } catch (error) {
    scalePercent.setCustomValidity(error.message);
    scalePercent.reportValidity();
    return;
  }
  cancelSupportAnalysis();
  supportResults = null;
  supportState = 'idle';
  modelDetails.size.set(...dimensions);
  printHeight.value = String(Number(modelDetails.size.z.toPrecision(10)));
  updateModelInfo(mesh.geometry.attributes.position.array, modelDetails.size, modelDetails.file);
  if (supportToggle.checked) startSupportAnalysis();
}

function cancelSupportAnalysis() {
  supportWorker?.terminate();
  supportWorker = null;
  clearTimeout(supportTimeout);
  supportTimeout = null;
  document.getElementById('printer-fit').setAttribute('aria-busy', 'false');
}

function startSupportAnalysis() {
  cancelSupportAnalysis();
  if (!modelDetails || !supportToggle.checked) return;
  supportState = 'working';
  supportStatus.hidden = false;
  supportStatus.textContent = 'Analyzing supports locally… 0 of 4 printers';
  document.getElementById('printer-fit').setAttribute('aria-busy', 'true');
  const geometry = mesh.geometry;
  const fail = (text) => {
    cancelSupportAnalysis();
    supportState = 'failed';
    supportStatus.textContent = text;
    updateModelInfo(geometry.attributes.position.array, modelDetails.size, modelDetails.file);
  };
  try {
    const instance = new Worker(new URL('./support-worker.js?v=20261029-3', import.meta.url), { type: 'module' });
    supportWorker = instance;
    instance.onmessage = ({ data }) => {
      if (supportWorker !== instance || mesh.geometry !== geometry) return;
      if (data.error) return fail(data.error);
      if (data.progress) {
        supportStatus.textContent = `Analyzing supports locally… ${data.progress} of 4 printers`;
        return;
      }
      cancelSupportAnalysis();
      supportResults = data.results;
      supportState = 'complete';
      updateModelInfo(geometry.attributes.position.array, modelDetails.size, modelDetails.file);
      supportStatus.textContent = supportSummary();
    };
    instance.onerror = (event) => { event.preventDefault(); fail('Support analysis could not start. Reload and try again.'); };
    instance.onmessageerror = () => fail('The support estimate could not be read.');
    supportTimeout = setTimeout(() => fail('Support analysis took too long. Use your slicer for this model.'), 45000);
    const positions = geometry.attributes.position.array.slice();
    const { x, y, z } = modelDetails.size;
    instance.postMessage({ positions, dimensions: [x, y, z] }, [positions.buffer]);
  } catch {
    fail('Support analysis is unavailable in this browser.');
  }
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
  cancelSupportAnalysis();
  supportResults = null;
  supportState = 'idle';
  const rawSize = size.clone();
  unitSelect.value = initialUnit(rawSize.toArray());
  autoSelectedInches = unitSelect.value === 'in';
  size.set(...scaledDimensions(rawSize.toArray(), unitSelect.value));
  scalePercent.value = '100';
  scalePercent.setCustomValidity('');
  printHeight.setCustomValidity('');
  printHeight.disabled = size.z === 0;
  printHeight.value = String(Number(size.z.toPrecision(10)));
  modelDetails = { rawSize, size, file };
  scene.add(mesh);
  viewportMessage.hidden = true;
  controls.autoRotate = true;
  viewRestore.cancel();
  fitView(false, false);
  updateModelInfo(positions, size, file);
  fitButton.disabled = contextLost;
  message();
  updateAnimation();
  if (supportToggle.checked) startSupportAnalysis();
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
    worker = new Worker(new URL('./stl-worker.js?v=20261029-3', import.meta.url), { type: 'module' });
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
  if (!enabled) { cancelCameraTransition(); updateAnimation(); }
});
supportToggle.addEventListener('change', () => {
  cancelSupportAnalysis();
  document.getElementById('support-note').hidden = !supportToggle.checked;
  supportStatus.hidden = !supportToggle.checked;
  if (!modelDetails) return;
  supportState = 'idle';
  if (supportToggle.checked && !supportResults) startSupportAnalysis();
  else if (supportToggle.checked) supportStatus.textContent = supportSummary();
  updateModelInfo(mesh.geometry.attributes.position.array, modelDetails.size, modelDetails.file);
});
unitSelect.addEventListener('change', () => { autoSelectedInches = false; applyPrintSize(); });
scalePercent.addEventListener('change', applyPrintSize);
printHeight.addEventListener('change', () => {
  if (!modelDetails || modelDetails.rawSize.z === 0) return;
  const height = Number(printHeight.value);
  printHeight.setCustomValidity('');
  const percent = height / (modelDetails.rawSize.z * UNIT_MM[unitSelect.value]) * 100;
  if (!Number.isFinite(height) || height <= 0 || percent > 1_000_000) {
    printHeight.setCustomValidity('Enter a positive print height within the allowed scale range.');
    printHeight.reportValidity();
    return;
  }
  scalePercent.value = String(percent);
  applyPrintSize();
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
  if (['Space', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(event.key) || event.code === 'Space') {
    cancelCameraTransition();
    updateAnimation();
  }
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
  if (mesh) fitView(true, false);
  else render();
}).observe(viewport);
new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; updateAnimation(); }).observe(viewport);
document.addEventListener('visibilitychange', updateAnimation);
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  cancelCameraTransition();
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
  cancelSupportAnalysis();
  cancelCameraTransition();
  viewRestore.cancel();
  ++loadVersion;
  cancelParsing();
  setBusy(false);
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
});
window.addEventListener('pageshow', () => {
  updateAnimation();
  if (supportToggle.checked && modelDetails && supportState === 'working' && !supportWorker) startSupportAnalysis();
});
fileInput.disabled = false;
autoRestoreButton.disabled = false;

// Optional images must not prevent the STL picker and main viewer from starting.
import('./plate-previews.js?v=20261029-3').then((module) => {
  platePreviews = module.platePreviews;
  if (modelDetails) updateModelInfo(mesh.geometry.attributes.position.array, modelDetails.size, modelDetails.file);
}).catch((error) => console.warn('Build plate preview module could not load:', error));
