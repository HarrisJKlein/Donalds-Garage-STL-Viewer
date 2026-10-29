// Nominal manufacturer build volumes, in X/Y/Z millimeters.
export const PRINTERS = [
  { name: 'UltiMaker S3', volume: [230, 190, 200] },
  { name: 'UltiMaker S5', volume: [330, 240, 300] },
  { name: 'UltiMaker S7', volume: [330, 240, 300] },
  { name: 'Comgrow T500', volume: [500, 500, 500] },
];

export function printerFit(dimensions, volume) {
  if (dimensions.every((size, axis) => size <= volume[axis])) return 'oriented';
  // Sorting tests whether any permutation of the original axes fits, without
  // claiming an arbitrary-angle packing or slicer clearance check.
  const sortedSize = [...dimensions].sort((a, b) => a - b);
  const sortedVolume = [...volume].sort((a, b) => a - b);
  return sortedSize.every((size, axis) => size <= sortedVolume[axis]) ? 'reorient' : 'exceeds';
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
