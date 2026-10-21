import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCreationArguments, resolveCreationMode } from '../src/core/creation-mode.js';

test('replica v2 stage and exact run continuation arguments stay separate from mode identity', () => {
  assert.deepEqual(parseCreationArguments(['task/program.json','--stage','desktop']), {filename:'task/program.json',mode:undefined,stage:'desktop'});
  assert.deepEqual(parseCreationArguments(['--mode','replica','task/program.json','--resume','D:/cloneWP/runs/task','--stage','final']), {filename:'task/program.json',mode:'replica',stage:'final',resume:'D:/cloneWP/runs/task'});
  for(const args of [['p.json','--stage','unknown'],['p.json','--stage','desktop','--stage','final'],['p.json','--resume'],['p.json','--resume','https://example.com/run'],['p.json','--resume','--stage','desktop']]) assert.equal(parseCreationArguments(args),undefined);
});

test('new replica schema does not reinterpret unknown input as original or legacy replica', () => {
  assert.throws(()=>resolveCreationMode({version:2,workflow:'block-replication'}),/Invalid block-replication/);
  assert.throws(()=>resolveCreationMode({version:3,workflow:'block-replication'}),/Invalid block-replication/);
  assert.throws(()=>resolveCreationMode({version:2,workflow:'unknown'}),/Unknown/);
});
