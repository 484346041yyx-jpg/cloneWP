import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReplicaEntry,runReplicaEntry} from '../src/replica-full/entry.js';
import {preparationIOFixture} from './helpers/preparation-io-fixture.js';

test('new replica entry cannot silently send a legacy body program to Canvas',()=>{
 const legacy={workflow:'block-replication'};
 assert.throws(()=>selectReplicaEntry(legacy,[]),/manifest_required/);
 assert.equal(selectReplicaEntry(legacy,['--provider','component']),'component');
 assert.equal(selectReplicaEntry(legacy,['--resume','D:/cloneWP/runs/frozen']),'component');
 assert.throws(()=>selectReplicaEntry(legacy,['--provider','woodmart-header-builder','--resume','frozen']),/provider_conflict/);
});
test('replica entry rejects ambiguous provider instructions before credentials',()=>{
 assert.throws(()=>selectReplicaEntry({},['--provider','auto']),/entry_provider/);
 assert.throws(()=>selectReplicaEntry({},['--provider','component','--provider','component']),/entry_provider/);
 assert.throws(()=>selectReplicaEntry({kind:'clonewp-full-replica'},['--provider','component']),/provider_conflict/);
 assert.throws(()=>selectReplicaEntry({workflow:'original-design'},['--provider','component']),/legacy_program_required/);
});
test('entry help exposes the preserved component command without remote work',async()=>{
 const result=await runReplicaEntry(['--help']) as {help:string;remoteWrites:number};
 assert.equal(result.remoteWrites,0);assert.match(result.help,/create:replica:component/);assert.match(result.help,/PREPARATION\.json/);
});
test('new preparation routes to native collaboration and cannot be mixed with legacy resume',async()=>{
 const fixture=await preparationIOFixture();
 try{
  assert.equal(selectReplicaEntry(fixture.plan,[]),'preparation');
  assert.throws(()=>selectReplicaEntry(fixture.plan,['--provider','component']),/provider_conflict/);
  assert.throws(()=>selectReplicaEntry(fixture.plan,['--resume','old-run']),/provider_conflict/);
  const input=await fixture.put('preparation.json',fixture.plan);
  const result=await runReplicaEntry([input.path,'--run-dir',fixture.finalRunDirectory]) as any;
  assert.equal(result.status,'awaiting-preparation');assert.equal(result.remoteWrites,0);
  assert.deepEqual(result.jobs.map((job:any)=>job.jobId),['header','body-1','body-2']);
 }finally{await fixture.cleanup();}
});
