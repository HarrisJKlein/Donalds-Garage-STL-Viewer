export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TRIANGLES = 1_000_000;

// Check counts before STLLoader allocates geometry. Parsing stays in a worker.
export function validateSTLBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error('This file is empty. Choose an STL exported from your CAD app.');
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('This file exceeds 50 MiB. Export a lower-resolution STL and try again.');
  }
  if (buffer.byteLength >= 84) {
    const faces = new DataView(buffer).getUint32(80, true);
    if (84 + 50 * faces === buffer.byteLength) {
      if (!faces) throw new Error('This STL contains no triangles.');
      if (faces > MAX_TRIANGLES) throw new Error('This model exceeds 1,000,000 triangles. Export a simpler STL.');
      return { format: 'binary', faces };
    }
  }
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '').trim();
  } catch {
    throw new Error('This binary STL appears incomplete or damaged. Export it again and retry.');
  }
  if (!/^solid(?:\s|$)/i.test(source) || !/endsolid[^\r\n]*$/i.test(source)) {
    throw new Error('This is not a complete STL file. Choose a binary or ASCII .stl export.');
  }
  const faces = (source.match(/\bfacet\s+normal\b/g) || []).length;
  const ends = (source.match(/\bendfacet\b/g) || []).length;
  const vertices = (source.match(/\bvertex\b/g) || []).length;
  if (!faces || faces !== ends || vertices !== faces * 3) {
    throw new Error('This ASCII STL has incomplete triangles. Export it again and retry.');
  }
  if (faces > MAX_TRIANGLES) throw new Error('This model exceeds 1,000,000 triangles. Export a simpler STL.');
  // Validate each complete facet so partial or nonnumeric coordinates cannot be silently skipped.
  const number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const vector = `${number}\\s+${number}\\s+${number}`;
  const facet = new RegExp(`facet\\s+normal\\s+${vector}\\s+outer\\s+loop\\s+vertex\\s+${vector}\\s+vertex\\s+${vector}\\s+vertex\\s+${vector}\\s+endloop\\s+endfacet`, 'g');
  let validFaces = 0;
  while (facet.exec(source)) validFaces++;
  if (validFaces !== faces) throw new Error('This ASCII STL contains an invalid triangle. Export it again and retry.');
  return { format: 'ASCII', faces };
}

export function validatePositions(positions, expectedFaces) {
  if (!positions || !positions.length || positions.length % 9 || positions.length / 9 !== expectedFaces) {
    throw new Error('No complete triangle mesh was found in this STL.');
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i]) || Math.abs(positions[i]) > 1e12) {
      throw new Error('This model contains invalid or excessively large coordinates. Re-export it near the CAD origin.');
    }
  }
}
