import * as THREE from './vendor/three.module.min.js';
import { PRINTERS, printerFit, printerOrientation } from './model-info.js';

let renderer;

// Render the actual mesh once per plate, sharing one extra WebGL context. The
// main geometry stays normalized; uniform transforms restore its real size.
export function platePreviews(geometry, dimensions, supports = null) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(640, 400);
    renderer.setClearColor(0x171b20);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  return PRINTERS.map(({ name, volume }, printerIndex) => {
    const scene = new THREE.Scene();
    const axes = printerOrientation(dimensions, volume) ?? [0, 1, 2];
    const size = axes.map((axis) => dimensions[axis]);
    const scale = 2 / Math.max(...volume, ...size);
    const [width, depth, height] = volume.map((value) => value * scale);
    const result = printerFit(dimensions, volume);
    const color = { oriented: 0x9ed7ac, reorient: 0xe6c16d, exceeds: 0xf28d8d }[result];
    scene.add(new THREE.HemisphereLight(0xffffff, 0x57687c, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(-3, -4, 6);
    scene.add(light);

    const plate = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: 0x35404d, side: THREE.DoubleSide, roughness: 1 }));
    plate.position.z = -0.002;
    scene.add(plate);
    const grid = new THREE.GridHelper(2, 10, 0x718299, 0x4b5b6d);
    grid.scale.set(width / 2, 1, depth / 2);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.001;
    scene.add(grid);
    const box = new THREE.BoxGeometry(width, depth, height);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x8291a5, transparent: true, opacity: 0.7 }));
    box.dispose();
    frame.position.z = height / 2;
    scene.add(frame);

    const model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }));
    const rotation = new THREE.Matrix4().set(
      ...[0, 1, 2].map((axis) => Number(axis === axes[0])), 0,
      ...[0, 1, 2].map((axis) => Number(axis === axes[1])), 0,
      ...[0, 1, 2].map((axis) => Number(axis === axes[2])), 0,
      0, 0, 0, 1,
    );
    // Odd axis permutations need a sign flip to remain a rotation, not a mirror.
    if (rotation.determinant() < 0) {
      for (let column = 0; column < 3; column++) rotation.elements[column * 4 + 1] *= -1;
    }
    model.setRotationFromMatrix(rotation);
    model.scale.setScalar(Math.max(...dimensions) / 2 * scale);
    model.position.z = size[2] * scale / 2;
    scene.add(model);
    const segments = supports?.[printerIndex]?.segments;
    if (segments?.length) {
      const branches = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.85, 1, 1, 8),
        new THREE.MeshStandardMaterial({ color: 0xbe9ce9, roughness: 0.85 }),
        segments.length / 8,
      );
      const matrix = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < segments.length; i += 8) {
        const from = new THREE.Vector3(...segments.subarray(i, i + 3)).multiplyScalar(scale);
        const to = new THREE.Vector3(...segments.subarray(i + 4, i + 7)).multiplyScalar(scale);
        const direction = to.clone().sub(from);
        const length = direction.length();
        const radius = segments[i + 3] * scale;
        matrix.compose(from.clone().add(to).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), new THREE.Vector3(radius, length, radius));
        branches.setMatrixAt(i / 8, matrix);
      }
      branches.instanceMatrix.needsUpdate = true;
      scene.add(branches);
    }

    // Include an oversized model in the framing so overflow remains visible.
    const extent = size.map((value, axis) => Math.max(value, volume[axis]) * scale);
    const target = new THREE.Vector3(0, 0, extent[2] / 2);
    const camera = new THREE.PerspectiveCamera(38, 640 / 400, 0.01, 100);
    camera.up.set(0, 0, 1);
    const distance = Math.hypot(...extent) / 2 / Math.sin(THREE.MathUtils.degToRad(19)) * 1.08;
    camera.position.copy(new THREE.Vector3(3.2, -4.8, 3.5).normalize().multiplyScalar(distance)).add(target);
    camera.lookAt(target);
    let image;
    try {
      renderer.render(scene, camera);
      image = renderer.domElement.toDataURL('image/png');
    } finally {
      scene.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
        if (object.geometry && object.geometry !== geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
      renderer.renderLists.dispose();
    }
    return { name, image, axes, size };
  });
}
