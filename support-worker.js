import { estimateTreeSupports } from './tree-support.js';
import { PRINTERS, printerOrientation } from './model-info.js';

self.onmessage = ({ data: { positions, dimensions } }) => {
  try {
    const results = PRINTERS.map(({ volume }, index) => {
      const axes = printerOrientation(dimensions, volume);
      const result = axes ? estimateTreeSupports(positions, dimensions, volume, axes) : { status: 'outside', segments: new Float32Array(), tips: 0, reached: 0 };
      self.postMessage({ progress: index + 1 });
      return result;
    });
    self.postMessage({ results }, results.map((result) => result.segments.buffer));
  } catch {
    self.postMessage({ error: 'Support analysis could not finish. Use your slicer for this model.' });
  }
};
