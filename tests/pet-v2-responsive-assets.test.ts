import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,mkdtemp,readFile,rm } from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';

test('responsive resolver downloads no unused resource, deduplicates selected inline source bytes and leaves manifest writing to its caller',async()=>{
  const base='D:/cloneWP/references';await mkdir(base,{recursive:true});const jobDir=await mkdtemp(path.join(base,'test-responsive-assets-'));
  try{
    const {resolvePetResponsiveAssetV2}=await import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-assets.mjs').href),assets:any[]=[];
    const resource={url:'inline-svg:actual-mobile-owner',kind:'svg',inline:'<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="#ffc000"/></svg>'};
    const [first,same]=await Promise.all([resolvePetResponsiveAssetV2({jobDir,resource,assets}),resolvePetResponsiveAssetV2({jobDir,resource,assets})]);assert.equal(first,same);assert.equal(assets.length,1);assert.equal(first.mediaType,'image/png');assert.equal((await sharp(await readFile(path.join(jobDir,first.localPath))).metadata()).width,3);
    const repeated=await resolvePetResponsiveAssetV2({jobDir,resource:{...resource,url:'inline-svg:another-real-position'},assets});assert.equal(assets.length,2);assert.notEqual(repeated.key,first.key);assert.equal(repeated.localPath,first.localPath);assert.equal(repeated.originalSourcePath,first.originalSourcePath);
    await assert.rejects(readFile(path.join(jobDir,'asset-manifest.json')),/ENOENT/);
    await assert.rejects(resolvePetResponsiveAssetV2({jobDir,resource:{url:'inline-svg:bad',kind:'svg',inline:'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'},assets}),/executable|external/);assert.equal(assets.length,2);
  }finally{assert.ok(path.resolve(jobDir).startsWith(path.resolve(base)+path.sep));await rm(jobDir,{recursive:true,force:true});}
});
