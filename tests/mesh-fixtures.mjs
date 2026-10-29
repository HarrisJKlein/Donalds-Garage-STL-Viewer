export function voxelModel(xs, ys, zs, filled) {
  const vertices = [];
  const directions = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const inside = (x, y, z) => x >= 0 && x < xs.length - 1 && y >= 0 && y < ys.length - 1 && z >= 0 && z < zs.length - 1 && filled(x, y, z);
  for (let z = 0; z < zs.length - 1; z++) for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    if (!inside(x, y, z)) continue;
    const corners = [[x,y,z],[x+1,y,z],[x+1,y+1,z],[x,y+1,z],[x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1]].map(([a,b,c]) => [xs[a], ys[b], zs[c]]);
    directions.forEach(([dx,dy,dz], index) => {
      if (inside(x+dx,y+dy,z+dz)) return;
      const [a,b,c,d] = faces[index];
      vertices.push(...corners[a],...corners[b],...corners[c],...corners[a],...corners[c],...corners[d]);
    });
  }
  const dimensions = [xs.at(-1)-xs[0], ys.at(-1)-ys[0], zs.at(-1)-zs[0]];
  const center = [(xs.at(-1)+xs[0])/2,(ys.at(-1)+ys[0])/2,(zs.at(-1)+zs[0])/2];
  const scale = 2 / Math.max(...dimensions);
  const positions = Float32Array.from(vertices, (value,index) => (value-center[index%3])*scale);
  return { positions, dimensions };
}

export const ledgeModel = () => voxelModel([-40,-10,10,40],[-40,-10,10,40],[0,70,90],(x,y,z) => z===1 || (x===1 && y===1));
