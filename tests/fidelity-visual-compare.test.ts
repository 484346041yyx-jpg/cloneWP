import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {compareVisualRegion} from '../src/fidelity/visual-compare.js';
test('visual gate detects a changed control even when outer boxes agree',async()=>{
 const dir=await mkdtemp('D:/cloneWP/.cache/test-visual-');
 try{const a=path.join(dir,'source.png'),b=path.join(dir,'target.png');await sharp({create:{width:40,height:40,channels:4,background:'#e2ebf0'}}).png().toFile(a);await sharp({create:{width:40,height:40,channels:4,background:'#0047d2'}}).png().toFile(b);
 const rect={x:0,y:0,width:40,height:40},options={source:a,target:b,sourceRect:rect,targetRect:rect,tolerance:{geometryPx:1,channel:4,differentPixelRatio:.01}};
 assert.equal((await compareVisualRegion({...options,target:a})).passed,true);assert.equal((await compareVisualRegion(options)).passed,false);
 await assert.rejects(()=>compareVisualRegion({...options,masks:[{source:rect,target:rect,reason:'ignore product block'}]}),/most/);
 await assert.rejects(()=>compareVisualRegion({...options,sourceRect:{...rect,width:NaN}}),/finite/);
 await assert.rejects(()=>compareVisualRegion({...options,output:a}),/overwrite/);
 await assert.rejects(()=>compareVisualRegion({...options,sourceRect:{x:0,y:0,width:8000000,height:1},targetRect:{x:0,y:0,width:1,height:8000000}}),/union/);
 const grey=path.join(dir,'grey.png');await sharp({create:{width:40,height:40,channels:3,background:'#000000'}}).greyscale().png().toFile(grey);assert.equal((await compareVisualRegion({...options,source:grey,target:a})).passed,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
