import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const report=JSON.parse(await readFile(run+'/comparison/report.json','utf8'));
for(const capture of report.captures){
 for(const role of ['source','target']){
  const file=capture[role].screenshot,meta=await sharp(file).metadata();
  await sharp(file).resize({width:850}).jpeg({quality:86}).toFile(run+'/comparison/'+capture.viewport+'-'+role+'-overview.jpg');
  await sharp(file).extract({left:0,top:0,width:meta.width!,height:Math.min(meta.height!,1080)}).resize({width:1440}).png().toFile(run+'/comparison/'+capture.viewport+'-'+role+'-top.png');
  await sharp(file).extract({left:0,top:Math.max(0,meta.height!-850),width:meta.width!,height:Math.min(meta.height!,850)}).resize({width:1440}).png().toFile(run+'/comparison/'+capture.viewport+'-'+role+'-footer.png');
 }
}
console.log('Inspection crops are local derivatives; original screenshots and hashes unchanged.');
