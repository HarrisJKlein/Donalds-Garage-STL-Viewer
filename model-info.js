// Nominal manufacturer build volumes, in X/Y/Z millimeters.
export const PRINTERS = [
  { name: 'UltiMaker S3', volume: [230, 190, 200] },
  { name: 'UltiMaker S5', volume: [330, 240, 300] },
  { name: 'UltiMaker S7', volume: [330, 240, 300] },
  { name: 'Comgrow T500', volume: [500, 500, 500] },
];

export function printerFit(dimensions, volume) {
  const axes = printerOrientation(dimensions, volume);
  if (!axes) return 'exceeds';
  return axes.every((axis, index) => axis === index) ? 'oriented' : 'reorient';
}

export function printerOrientation(dimensions, volume) {
  // Use the same orientation for the fit result and the actual model preview.
  const orientations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  return orientations.find((axes) => axes.every((axis, index) => dimensions[axis] <= volume[index])) ?? null;
}

export function formatDimension(value) {
  if (value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6)) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function formatFileSize(bytes) {
  const exact = `${bytes.toLocaleString()} bytes`;
  if (bytes < 1024) return exact;
  const unit = bytes < 1024 * 1024 ? 'KiB' : 'MiB';
  const divisor = unit === 'KiB' ? 1024 : 1024 * 1024;
  return `${(bytes / divisor).toFixed(1)} ${unit} (${exact})`;
}
