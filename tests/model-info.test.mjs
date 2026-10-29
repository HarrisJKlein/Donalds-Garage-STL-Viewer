import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINTERS, printerFit, printerOrientation, formatDimension, formatFileSize, scaledDimensions, initialUnit } from '../model-info.js';

test('nominal printer volumes fit at the boundary, but a larger cube does not', () => {
  for (const { volume } of PRINTERS) {
    assert.equal(printerFit(volume, volume), 'oriented');
    const tooLarge = Math.max(...volume) + 0.01;
    assert.equal(printerFit([tooLarge, tooLarge, tooLarge], volume), 'exceeds');
  }
});

test('distinguishes current orientation from a fit requiring reorientation', () => {
  assert.equal(printerFit([200, 230, 190], [230, 190, 200]), 'reorient');
  assert.equal(printerFit([230, 190, 200], [230, 190, 200]), 'oriented');
  assert.equal(printerFit([230.001, 190, 200], [230, 190, 200]), 'exceeds');
  assert.equal(printerFit([200, 200, 200], [230, 190, 200]), 'exceeds');
});

test('checks the original dimensions against each printer without mutating them', () => {
  const size = [300, 200, 250];
  assert.deepEqual(PRINTERS.map(({ volume }) => printerFit(size, volume)), ['exceeds', 'oriented', 'oriented', 'oriented']);
  assert.deepEqual(size, [300, 200, 250]);
});

test('preview orientation agrees with fit results for all axis permutations', () => {
  const volume = [230, 190, 200];
  for (const size of [[230, 190, 200], [230, 200, 190], [190, 230, 200], [190, 200, 230], [200, 230, 190], [200, 190, 230]]) {
    const axes = printerOrientation(size, volume);
    assert.equal(new Set(axes).size, 3);
    assert.deepEqual(axes.map((axis) => size[axis]), volume);
    assert.notEqual(printerFit(size, volume), 'exceeds');
  }
  assert.equal(printerOrientation([231, 200, 190], volume), null);
});

test('formats small dimensions without rounding them to zero, and exact file bytes', () => {
  assert.equal(formatDimension(0.00001), '1.000e-5');
  assert.equal(formatFileSize(134), '134 bytes');
  assert.equal(formatFileSize(1024), `1.0 KiB (${(1024).toLocaleString()} bytes)`);
  assert.equal(formatFileSize(1048576), `1.0 MiB (${(1048576).toLocaleString()} bytes)`);
});

test('converts explicit STL units and print scale without guessing or mutating source dimensions', () => {
  const raw = [0.61, 0.61, 1.537];
  assert.deepEqual(scaledDimensions(raw), raw);
  assert.deepEqual(scaledDimensions(raw, 'm'), [610, 610, 1537]);
  assert.ok(Math.abs(scaledDimensions(raw, 'in')[2] - 39.0398) < 1e-9);
  assert.ok(Math.abs(scaledDimensions(raw, 'cm', 200)[2] - 30.74) < 1e-9);
  const target = scaledDimensions(raw, 'mm', 150 / raw[2] * 100);
  assert.ok(Math.abs(target[2] - 150) < 1e-9);
  assert.ok(Math.abs(target[0] / target[2] - raw[0] / raw[2]) < 1e-9);
  assert.deepEqual(raw, [0.61, 0.61, 1.537]);
  for (const percent of [0, -1, NaN, Infinity, 1_000_001]) assert.throws(() => scaledDimensions(raw, 'mm', percent));
  assert.throws(() => scaledDimensions(raw, 'unknown'));
});

test('automatically selects inches only for files smaller than 5 in every dimension', () => {
  assert.equal(initialUnit([0.61,0.61,1.537]),'in');
  assert.equal(initialUnit([4.999,2,3]),'in');
  assert.equal(initialUnit([5,2,3]),'mm');
  assert.equal(initialUnit([0.61,0.61,150]),'mm');
  assert.equal(initialUnit([60,60,20]),'mm');
  assert.equal(initialUnit([0,0,0]),'mm');
});
