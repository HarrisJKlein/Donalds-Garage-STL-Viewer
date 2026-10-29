import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewRestore } from '../view-restore.js';

test('restores once after ten seconds and waits for a user adjustment to arm again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const view = createViewRestore(() => count++);
  t.mock.timers.tick(20_000);
  assert.equal(count, 0);
  view.adjusted();
  t.mock.timers.tick(9_999);
  assert.equal(count, 0);
  t.mock.timers.tick(1);
  assert.equal(count, 1);
  t.mock.timers.tick(30_000);
  assert.equal(count, 1);
});

test('new adjustments restart the countdown, and an active drag suspends it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const view = createViewRestore(() => count++);
  view.adjusted();
  t.mock.timers.tick(9_000);
  view.adjusted();
  t.mock.timers.tick(9_000);
  assert.equal(count, 0);
  view.start();
  view.adjusted();
  t.mock.timers.tick(30_000);
  assert.equal(count, 0);
  view.end();
  t.mock.timers.tick(9_999);
  assert.equal(count, 0);
  t.mock.timers.tick(1);
  assert.equal(count, 1);
});

test('disabling cancels pending and future resets, and re-enabling starts a fresh countdown', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const view = createViewRestore(() => count++);
  view.adjusted();
  t.mock.timers.tick(5_000);
  view.setEnabled(false);
  view.start();
  view.end();
  view.adjusted();
  t.mock.timers.tick(30_000);
  assert.equal(count, 0);
  view.setEnabled(true);
  t.mock.timers.tick(9_999);
  assert.equal(count, 0);
  t.mock.timers.tick(1);
  assert.equal(count, 1);
  view.adjusted();
  view.cancel();
  t.mock.timers.tick(20_000);
  assert.equal(count, 1);
});
