// Independent, coarse browser implementation of the published tree-support
// stages: contacts, collision/reachability fields, downward branching/merging,
// and constrained smoothing. See docs/tree-supports.md for upstream references
// and differences from a full slicer. Coordinates and returned radii are mm.
const MAX_RASTER_WORK = 12_000_000;
const MAX_TIPS = 80;
const ANGLE = 40 * Math.PI / 180;
const GAP = 0.25;

export function estimateTreeSupports(positions, dimensions, volume, axes = [0, 1, 2]) {
  const size = axes.map((axis) => dimensions[axis]);
  if (size.some((value, axis) => value > volume[axis])) return { status: 'outside', segments: new Float32Array(), tips: 0, reached: 0 };
  const span = size.slice(0, 2).map((value, axis) => Math.min(volume[axis], value + 50));
  const cell = Math.max(1.5, ...span.map((value) => value / 72));
  const width = Math.max(1, Math.floor(span[0] / cell));
  const depth = Math.max(1, Math.floor(span[1] / cell));
  const step = Math.max(2, cell * 1.8, size[2] / 120);
  if (size[2] <= step + GAP || Math.min(size[0], size[1]) < cell * 2) {
    return { status: 'resolution', segments: new Float32Array(), tips: 0, reached: 0, cell, step };
  }
  const layers = Math.ceil(size[2] / step) + 1;
  const count = width * depth;
  const columns = Array.from({ length: count }, () => []);
  const origin = [-width * cell / 2, -depth * cell / 2];
  const xAt = (x) => origin[0] + (x + 0.5) * cell;
  const yAt = (y) => origin[1] + (y + 0.5) * cell;
  const unscale = Math.max(...dimensions) / 2;
  // Use a proper rotation for odd permutations, just like the plate renderer.
  const parity = ((axes[0] > axes[1]) + (axes[0] > axes[2]) + (axes[1] > axes[2])) % 2;
  const vertex = (offset) => axes.map((axis, index) => positions[offset + axis] * unscale * (index === 1 && parity ? -1 : 1) + (index === 2 ? size[2] / 2 : 0));
  let work = 0;
  // Intersect vertical grid rays with triangles. Sorted pairs of intersections
  // give solid intervals for a closed STL, including cavities and ledges.
  for (let offset = 0; offset < positions.length; offset += 9) {
    const a = vertex(offset), b = vertex(offset + 3), c = vertex(offset + 6);
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(determinant) < 1e-10) continue;
    const minX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - origin[0]) / cell));
    const maxX = Math.min(width - 1, Math.floor((Math.max(a[0], b[0], c[0]) - origin[0]) / cell));
    const minY = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - origin[1]) / cell));
    const maxY = Math.min(depth - 1, Math.floor((Math.max(a[1], b[1], c[1]) - origin[1]) / cell));
    work += Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1);
    if (work > MAX_RASTER_WORK) return { status: 'complex', segments: new Float32Array(), tips: 0, reached: 0 };
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = xAt(x), py = yAt(y);
      const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / determinant;
      const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / determinant;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) columns[y * width + x].push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
    }
  }
  let invalid = false;
  for (let index = 0; index < count; index++) {
    const sorted = columns[index].sort((a, b) => a - b);
    columns[index] = sorted.filter((z, i) => i === 0 || Math.abs(z - sorted[i - 1]) > 1e-5);
    if (columns[index].length % 2) invalid = true;
  }
  // Open/nonmanifold surfaces cannot safely be interpreted as solid intervals.
  if (invalid) return { status: 'open', segments: new Float32Array(), tips: 0, reached: 0 };
  if (!columns.some((column) => column.length)) return { status: 'resolution', segments: new Float32Array(), tips: 0, reached: 0, cell, step };
  const occupied = (index, z, top = z) => {
    const spans = columns[index];
    for (let i = 0; i < spans.length; i += 2) if (top >= spans[i] - 0.05 && z <= spans[i + 1] + 0.05) return true;
    return false;
  };
  const free = (x, y, z, radius, top = z) => {
    const px = xAt(x), py = yAt(y);
    if (Math.abs(px) + radius > volume[0] / 2 || Math.abs(py) + radius > volume[1] / 2) return false;
    const cells = Math.ceil(radius / cell);
    for (let dy = -cells; dy <= cells; dy++) for (let dx = -cells; dx <= cells; dx++) {
      if (Math.hypot(dx * cell, dy * cell) > radius + cell * 0.55) continue;
      const ix = x + dx, iy = y + dy;
      if (ix >= 0 && ix < width && iy >= 0 && iy < depth && occupied(iy * width + ix, z, top)) return false;
    }
    return true;
  };
  const clearSegment = (a, b, radius) => {
    const parts = Math.max(1, Math.ceil(Math.hypot(b.px - a.px, b.py - a.py) / (cell * 0.5)));
    for (let part = 0; part < parts; part++) {
      const t = (part + 0.5) / parts;
      const x = Math.floor((a.px + (b.px - a.px) * t - origin[0]) / cell);
      const y = Math.floor((a.py + (b.py - a.py) * t - origin[1]) / cell);
      const z1 = a.z + (b.z - a.z) * part / parts;
      const z2 = a.z + (b.z - a.z) * (part + 1) / parts;
      if (!free(x, y, Math.min(z1, z2), radius, Math.max(z1, z2))) return false;
    }
    return true;
  };
  const moves = [];
  const movement = Math.tan(ANGLE) * step;
  const moveCells = Math.ceil(movement / cell);
  for (let dy = -moveCells; dy <= moveCells; dy++) for (let dx = -moveCells; dx <= moveCells; dx++) {
    if (Math.hypot(dx * cell, dy * cell) <= movement + 1e-6) moves.push([dx, dy]);
  }
  // A bottom-up field marks cells with a collision-free, angle-limited route
  // to the plate. It guides the subsequent top-down branch propagation.
  const reachable = new Uint8Array(layers * count);
  for (let layer = 0; layer < layers; layer++) {
    const z = layer * step + 0.1;
    for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
      if (!free(x, y, z, 0.5)) continue;
      if (layer === 0 || moves.some(([dx, dy]) => {
        const px = x + dx, py = y + dy;
        return px >= 0 && px < width && py >= 0 && py < depth && reachable[(layer - 1) * count + py * width + px];
      })) reachable[layer * count + y * width + x] = 1;
    }
  }
  // Seed unsupported lower surfaces; adjacent solid below a sloped face can
  // carry it. A coarse 45-degree overhang threshold suppresses those contacts.
  const contacts = [];
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const spans = columns[y * width + x];
    for (let i = 0; i < spans.length; i += 2) {
      const z = spans[i] - GAP;
      if (z < step) continue;
      let supported = false;
      const radius = Math.max(1, Math.floor(step / cell));
      for (let dy = -radius; dy <= radius && !supported; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (Math.hypot(dx * cell, dy * cell) <= step && nx >= 0 && nx < width && ny >= 0 && ny < depth && occupied(ny * width + nx, spans[i] - step)) { supported = true; break; }
      }
      if (!supported) contacts.push({ x, y, z });
    }
  }
  const selected = [];
  const spacing = Math.max(4, Math.sqrt(size[0] * size[1] / MAX_TIPS));
  // Walk a stable, interleaved sample to cover the footprint rather than
  // filling the tip budget only from the first edge of the model.
  for (let phase = 0; phase < 5 && selected.length < MAX_TIPS; phase++) {
    for (let i = phase; i < contacts.length && selected.length < MAX_TIPS; i += 5) {
      const tip = contacts[i];
      if (selected.every((other) => Math.hypot((tip.x - other.x) * cell, (tip.y - other.y) * cell, tip.z - other.z) >= spacing)) selected.push(tip);
    }
  }
  const seeds = Array.from({ length: layers }, () => []);
  const nodes = [];
  for (const tip of selected) {
    const node = { ...tip, radius: 0.4, children: [], tip: true, parent: null, reached: false };
    nodes.push(node);
    seeds[Math.min(layers - 1, Math.floor(tip.z / step))].push(node);
  }
  let active = [];
  const roots = [];
  for (let layer = layers - 1; layer >= 0; layer--) {
    active.push(...seeds[layer]);
    if (!active.length) continue;
    const z = layer * step;
    const candidates = new Map();
    for (const node of active) {
      const dz = node.z - z;
      const radius = Math.min(3.5, node.radius + dz * Math.tan(Math.PI / 180));
      const closest = active.filter((other) => other !== node).sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y))[0];
      for (const [dx, dy] of moves) {
        if (Math.hypot(dx * cell, dy * cell) > dz * Math.tan(ANGLE) + 1e-5) continue;
        const x = node.x + dx, y = node.y + dy;
        if (x < 0 || x >= width || y < 0 || y >= depth || !reachable[layer * count + y * width + x] || !free(x, y, z + 0.1, radius)) continue;
        if (!clearSegment({ px: xAt(node.x), py: yAt(node.y), z: node.z }, { px: xAt(x), py: yAt(y), z }, radius)) continue;
        const score = closest ? Math.hypot(x - closest.x, y - closest.y) + 0.1 * Math.hypot(dx, dy) : Math.hypot(dx, dy);
        const key = y * width + x;
        const candidate = { node, x, y, radius, score };
        if (!candidates.has(key)) candidates.set(key, []);
        candidates.get(key).push(candidate);
      }
    }
    const assigned = new Set();
    const next = [];
    const groups = [...candidates.values()].sort((a, b) => b.length - a.length || a.reduce((sum, item) => sum + item.score, 0) - b.reduce((sum, item) => sum + item.score, 0));
    for (const group of groups) {
      const available = group.filter(({ node }) => !assigned.has(node));
      if (!available.length) continue;
      const { x, y } = available[0];
      const radius = Math.min(3.5, Math.sqrt(available.reduce((sum, item) => sum + item.radius ** 2, 0)));
      if (!free(x, y, z + 0.1, radius)) continue;
      if (!available.every(({ node }) => clearSegment({ px: xAt(node.x), py: yAt(node.y), z: node.z }, { px: xAt(x), py: yAt(y), z }, radius))) continue;
      const node = { x, y, z, radius, children: available.map((item) => item.node), parent: null, reached: false };
      for (const child of node.children) { assigned.add(child); child.parent = node; }
      nodes.push(node);
      if (layer === 0) roots.push(node);
      else next.push(node);
    }
    active = next;
  }
  // Keep only complete trees rooted on the bed; never draw disconnected limbs.
  const mark = (node) => { node.reached = true; node.children.forEach(mark); };
  roots.forEach(mark);
  for (const node of nodes) { node.px = xAt(node.x); node.py = yAt(node.y); }
  const connected = nodes.filter((node) => node.reached);
  // Mild, collision-constrained Laplacian smoothing. Contacts/roots stay locked.
  for (let iteration = 0; iteration < 2; iteration++) for (const node of connected) {
    if (node.tip || !node.parent || !node.children.length) continue;
    const neighbors = [node.parent, ...node.children];
    const px = node.px * 0.5 + neighbors.reduce((sum, item) => sum + item.px, 0) / neighbors.length * 0.5;
    const py = node.py * 0.5 + neighbors.reduce((sum, item) => sum + item.py, 0) / neighbors.length * 0.5;
    const x = Math.floor((px - origin[0]) / cell), y = Math.floor((py - origin[1]) / cell);
    if (neighbors.every((other) => Math.hypot(px - other.px, py - other.py) <= Math.abs(node.z - other.z) * Math.tan(ANGLE) + 1e-5 && clearSegment({ px, py, z: node.z }, other, Math.max(node.radius, other.radius))) && free(x, y, node.z, node.radius)) { node.px = px; node.py = py; }
  }
  const segments = [];
  for (const node of connected) for (const child of node.children) {
    if (child.z - node.z < 1e-5) continue;
    segments.push(node.px, node.py, node.z, node.radius, child.px, child.py, child.z, child.radius);
  }
  return { status: 'estimated', segments: new Float32Array(segments), tips: selected.length, reached: selected.length ? nodes.filter((node) => node.tip && node.reached).length : 0, cell, step };
}
