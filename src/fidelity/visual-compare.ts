import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export interface VisualRect{x:number;y:number;width:number;height:number}
export interface VisualComparisonOptions{
 source:string;target:string;sourceRect:VisualRect;targetRect:VisualRect;
 /** Masks are independently relative to each crop. Never mask its whole interaction region. */
 masks?:Array<{source:VisualRect;target:VisualRect;reason:string}>;
 tolerance:{geometryPx:number;channel:number;differentPixelRatio:number};
 output?:string;
 /** Read-only bytes already hash-checked by the official acceptance session; avoids rereading each screenshot for every region. */
 inputBytes?:{source:Buffer;target:Buffer};
}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function rectangle(rect:VisualRect){if(!Object.values(rect).every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.width*rect.height>8_000_000)throw Error('Visual comparisons require finite bounded crop rectangles');return{left:Math.floor(rect.x),top:Math.floor(rect.y),width:Math.max(1,Math.round(rect.width)),height:Math.max(1,Math.round(rect.height))};}
/** Local, explicit comparison; geometry is never corrected by resizing the rendered output. */
export async function compareVisualRegion(options:VisualComparisonOptions){
 if(options.output&&[options.source,options.target].some(file=>path.resolve(file).toLowerCase()===path.resolve(options.output!).toLowerCase()))throw Error('A visual difference image cannot overwrite source evidence');
 const a=rectangle(options.sourceRect),b=rectangle(options.targetRect),t=options.tolerance;
 if(!Number.isFinite(t.geometryPx)||t.geometryPx<0||!Number.isFinite(t.channel)||t.channel<0||t.channel>255||!Number.isFinite(t.differentPixelRatio)||t.differentPixelRatio<0||t.differentPixelRatio>1)throw Error('Visual tolerances must be explicit and bounded');
 const width=Math.max(a.width,b.width),height=Math.max(a.height,b.height);if(width*height>8_000_000)throw Error('Visual union canvas exceeds its bounded area');
 const files=options.inputBytes?[options.inputBytes.source,options.inputBytes.target]:await Promise.all([readFile(options.source),readFile(options.target)]);
 const rgba=await Promise.all(files.map(async(bytes,index)=>{const rect=index?b:a,meta=await sharp(bytes,{limitInputPixels:100_000_000}).metadata();if(rect.left+rect.width>(meta.width??0)||rect.top+rect.height>(meta.height??0))throw Error('Visual crop escaped its actual screenshot');const result=await sharp(bytes).extract(rect).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});if(result.info.channels!==4)throw Error('Visual comparison requires actual four-channel sRGB pixels');return result.data;}));
 const mask=new Uint8Array(width*height);
 for(const pair of options.masks??[]){if(!pair.reason.trim())throw Error('Every visual content mask needs an explicit dynamic-field reason');for(const [rect,frame]of [[rectangle(pair.source),a],[rectangle(pair.target),b]] as const){if(rect.left+rect.width>frame.width||rect.top+rect.height>frame.height)throw Error('Visual mask escaped its declared crop');for(let y=rect.top;y<rect.top+rect.height;y++)for(let x=rect.left;x<rect.left+rect.width;x++)mask[y*width+x]=1;}}
 const masked=mask.reduce((sum,n)=>sum+n,0);if(masked>=width*height*.8)throw Error('A visual mask cannot exempt most of a component or its controls');
 const diff=Buffer.alloc(width*height*4);let compared=0,different=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=y*width+x;if(mask[index])continue;compared++;
  let delta=x>=a.width||y>=a.height||x>=b.width||y>=b.height;
  if(!delta)for(let channel=0;channel<4;channel++)if(Math.abs(rgba[0][(y*a.width+x)*4+channel]-rgba[1][(y*b.width+x)*4+channel])>t.channel){delta=true;break;}
  if(delta){different++;diff.set([230,20,70,255],index*4);}else diff.set([240,240,240,100],index*4);
 }
 const ratio=compared?different/compared:1,geometryPassed=Math.abs(a.width-b.width)<=t.geometryPx&&Math.abs(a.height-b.height)<=t.geometryPx;
 if(options.output){await mkdir(path.dirname(options.output),{recursive:true});await sharp(diff,{raw:{width,height,channels:4}}).png().toFile(options.output);}
 return{version:1,passed:geometryPassed&&ratio<=t.differentPixelRatio,geometryPassed,sourceSha256:hash(files[0]),targetSha256:hash(files[1]),sourceRect:options.sourceRect,targetRect:options.targetRect,tolerance:t,comparedPixels:compared,differentPixels:different,differentPixelRatio:ratio,maskedPixels:masked,masks:options.masks??[],...(options.output?{differenceImage:options.output}:{})};
}
