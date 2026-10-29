import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTreeSupports } from '../tree-support.js';
import { voxelModel, ledgeModel } from './mesh-fixtures.mjs';

test('a flat block needs no support contacts at the estimated resolution', () => {
  const { positions, dimensions } = voxelModel([-30,30],[-30,30],[0,20],()=>true);
  const result = estimateTreeSupports(positions, dimensions, [230,190,200]);
  assert.equal(result.status,'estimated');
  assert.equal(result.tips,0);
  assert.equal(result.segments.length,0);
});

test('a closed overhanging ledge produces bed-rooted, angle-limited trees clear of its pillar', () => {
  const { positions, dimensions } = ledgeModel();
  const result = estimateTreeSupports(positions, dimensions, [230,190,200]);
  assert.equal(result.status,'estimated');
  assert.ok(result.tips>0);
  assert.ok(result.reached>0);
  assert.ok(result.reached<=result.tips);
  assert.ok(result.segments.length>0);
  let bedRoots=0;
  for(let i=0;i<result.segments.length;i+=8) {
    const [x,y,z,r,tx,ty,tz,tr]=result.segments.subarray(i,i+8);
    assert.ok([x,y,z,r,tx,ty,tz,tr].every(Number.isFinite));
    assert.ok(z>=0 && tz>z);
    assert.ok(r>0 && tr>0);
    assert.ok(Math.hypot(tx-x,ty-y)<=Math.tan(40*Math.PI/180)*(tz-z)+0.0001);
    if(z===0) bedRoots++;
    for(let t=0;t<=1;t+=0.1) {
      const px=x+(tx-x)*t,py=y+(ty-y)*t,pz=z+(tz-z)*t;
      assert.ok(!(Math.abs(px)<10 && Math.abs(py)<10 && pz<70),'branch intersects pillar');
      assert.ok(Math.abs(px)+Math.max(r,tr)<115 && Math.abs(py)+Math.max(r,tr)<95,'branch exceeds plate');
    }
  }
  assert.ok(bedRoots>0);
});

test('uses the selected printer orientation and reports unsupported inputs explicitly', () => {
  const { positions, dimensions } = ledgeModel();
  const rotated = estimateTreeSupports(positions, dimensions, [230,190,200],[2,0,1]);
  assert.equal(rotated.status,'estimated');
  assert.equal(estimateTreeSupports(positions, dimensions, [50,50,50]).status,'outside');
  const open = estimateTreeSupports(positions.subarray(9), dimensions, [230,190,200]);
  assert.equal(open.status,'open');
  assert.equal(open.segments.length,0);
});

test('does not draw disconnected supports inside a sealed cavity', () => {
  const { positions, dimensions } = voxelModel([-40,-30,30,40],[-40,-30,30,40],[0,10,70,80],(x,y,z) => !(x===1 && y===1 && z===1));
  const result = estimateTreeSupports(positions, dimensions, [230,190,200]);
  assert.equal(result.status,'estimated');
  assert.ok(result.tips>0);
  assert.equal(result.reached,0);
  assert.equal(result.segments.length,0);
});
