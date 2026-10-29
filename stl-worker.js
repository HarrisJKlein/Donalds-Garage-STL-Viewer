import { STLLoader } from './vendor/STLLoader.js';
import { validateSTLBuffer, validatePositions } from './stl-validation.js?v=20261029-3';

self.onmessage = ({ data: buffer }) => {
  let geometry;
  try {
    const { faces, format } = validateSTLBuffer(buffer);
    geometry = new STLLoader().parse(buffer);
    const positions = geometry.getAttribute('position').array;
    validatePositions(positions, faces);
    self.postMessage({ positions, format }, [positions.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || 'This STL could not be read. Try a fresh export.' });
  } finally {
    geometry?.dispose();
  }
};
