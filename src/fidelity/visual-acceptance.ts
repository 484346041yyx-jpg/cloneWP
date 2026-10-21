import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {writeJson} from '../core/files.js';
import type{BlockContract,NativeProgram}from'./types.js';
import type{TargetViewportEvidence,Viewport}from'../verification/types.js';
import type{SourceTextPaintPacket}from'./text-paint.js';
import {presentationItems,type TargetPresentationEvidence,type PresentationRect}from'./presentation-contract.js';
import {compareVisualRegion,type VisualRect}from'./visual-compare.js';
import {observedRasterScale}from'../verification/raster-scale.js';
import type{CompletionIssue}from'./completion.js';
import {validateTargetCatalogBindings,catalogRenderProblems,catalogTemplateOwnedBy,type CatalogRenderEvidence,type CatalogRolePaintReport}from'./catalog-contract.js';

export interface VisualSourceViewport extends Viewport {
  sourceEvidencePath?:string;sourceScreenshotPath?:string;observationKind?:'full'|'probe';
  deviceFacts?:{profile?:'desktop'|'mobile'|'touch';innerWidth?:number;clientWidth?:number;devicePixelRatio?:number;touch?:boolean;coarsePointer?:boolean};
}
export interface VisualAcceptanceReport {
  version:1;passed:boolean;status:'passed'|'failed'|'needs-review';
  checks:Array<{viewport:string;blockId:string;regionId:string;status:'passed'|'failed'|'unverified'|'source-hidden';source?:string;target?:string;sourceRect?:VisualRect;targetRect?:VisualRect;evidence:string[];comparison?:Awaited<ReturnType<typeof compareVisualRegion>>;reason?:string;checkpoint?:'reused'|'measured'}>;
  issues:CompletionIssue[];
  runtime:{durationMs:number;comparedRegions:number;reusedRegions:number;imageReads:number};
  notice:string;
}
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const finite=(rect:PresentationRect|undefined):rect is PresentationRect=>!!rect&&Object.values(rect).every(Number.isFinite)&&rect.width>0&&rect.height>0;
const overlap=(a:PresentationRect,b:PresentationRect)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
const absolute=(root:PresentationRect,rect:PresentationRect):VisualRect=>({x:root.x+rect.x,y:root.y+rect.y,width:rect.width,height:rect.height});
const safeLabel=(value:string)=>value.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100);

/** Only exact dynamic leaf rectangles may be excluded; card chrome and interaction controls remain measured. */
export function validateDynamicPixelExclusions(input:{
  sourceCard:VisualRect;targetCard:VisualRect;sourceControls:VisualRect[];targetControls:VisualRect[];
  fields:Array<{field:'name'|'image'|'price'|'rating'|'availability';source:VisualRect;target:VisualRect;sourceNodeId:string;targetProductId:number;evidence:string[];dataVerified:boolean;layoutVerified:boolean;styleVerified:boolean}>;
}){
  const inside=(a:VisualRect,b:VisualRect)=>finite(a)&&finite(b)&&a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
  if(!finite(input.sourceCard)||!finite(input.targetCard))throw Error('Dynamic visual exclusions require measured finite card frames');
  return input.fields.map(field=>{
    if(!field.sourceNodeId.trim()||!Number.isSafeInteger(field.targetProductId)||field.targetProductId<1||!field.evidence.length||!field.dataVerified||!field.layoutVerified||!field.styleVerified)throw Error('Dynamic pixels require exact source ownership, verified target data, independent field layout and style evidence');
    if(!inside(field.source,input.sourceCard)||!inside(field.target,input.targetCard))throw Error('Dynamic visual field escaped its own product card');
    if(field.source.width*field.source.height>=input.sourceCard.width*input.sourceCard.height*.8||field.target.width*field.target.height>=input.targetCard.width*input.targetCard.height*.8)throw Error('A product card or track cannot be treated as a dynamic field');
    if(input.sourceControls.some(rect=>overlap(rect,field.source))||input.targetControls.some(rect=>overlap(rect,field.target)))throw Error('Dynamic product pixels cannot mask carousel controls');
    return {source:field.source,target:field.target,reason:`Verified target product ${field.targetProductId} ${field.field}; source owner ${field.sourceNodeId}; independent geometry/style retained`};
  });
}

/**
 * Official local screenshot gate. Source coordinates come from hash-checked source packets,
 * target coordinates from the actual browser. No output resizing or whole-product masks.
 * Checkpoints reuse only comparisons of the exact screenshot bytes/rectangles/tolerances.
 */
export async function verifyVisualAcceptance(options:{contract:BlockContract;program:NativeProgram;sourceViewports:VisualSourceViewport[];measurements:TargetViewportEvidence[];presentationEvidence:TargetPresentationEvidence[];sourcePackets:SourceTextPaintPacket[];runDir:string;sourceJobDir?:string;planGaps?:Array<{code:string;message:string;viewport?:string}>;catalogRenders?:CatalogRenderEvidence[];catalogRolePaint?:CatalogRolePaintReport}):Promise<VisualAcceptanceReport>{
  const started=Date.now(),checks:VisualAcceptanceReport['checks']=[],issues:CompletionIssue[]=[...(options.planGaps??[]).map(gap=>({...gap,severity:'warning' as const}))];
  const jobDir=options.sourceJobDir??(path.isAbsolute(options.program.sourceContract.path)?path.dirname(options.program.sourceContract.path):path.dirname(path.dirname(options.contract.referenceReport.path))),resolveSource=(file:string)=>path.resolve(path.isAbsolute(file)?file:path.join(jobDir,file));
  const directory=path.join(options.runDir,'verification','visual'),known=new Map(options.contract.evidence.map(evidence=>[resolveSource(evidence.path).toLowerCase(),evidence]));
  await mkdir(directory,{recursive:true});
  const imageCache=new Map<string,Promise<{bytes:Buffer;sha256:string;width:number;height:number}>>();
  const catalogBindings=validateTargetCatalogBindings(options.contract,options.program);
  let comparatorSha256:string|undefined;
  for(const filename of [new URL('./visual-compare.ts',import.meta.url),new URL('./visual-compare.js',import.meta.url)]){
    try{comparatorSha256=digest(await readFile(filename));break;}catch{/* Source and compiled execution use different extensions. */}
  }
  const imageInfo=(file:string)=>{let pending=imageCache.get(file);if(!pending){pending=(async()=>{const bytes=await readFile(file),metadata=await sharp(bytes).metadata();return{bytes,sha256:digest(bytes),width:metadata.width??0,height:metadata.height??0};})();imageCache.set(file,pending);}return pending;};
  const add=(code:string,message:string,viewport:string,blockId?:string,severity:'error'|'warning'='warning')=>issues.push({code,severity,message,viewport,blockId});
  let reusedRegions=0;
  for(const source of options.sourceViewports){
    const target=options.measurements.find(view=>view.name===source.name);
    if(!target){add('visual-target-viewport-missing','A captured source viewport has no matching target browser screenshot',source.name);continue;}
    if(target.screenshotGeometry?.status==='changed-after-screenshot')add('visual-target-screenshot-layoutmetrics-changed','Full-page screenshot changed observed browser metrics; retain the pixels as diagnostic evidence and do not grant visual acceptance from this sample',source.name);
    for(const gap of target.screenshotGeometry?.gaps??[])if(gap.code!=='screenshot-layoutmetrics-changed')add('visual-target-'+gap.code,gap.message,source.name);
    let sourcePath=source.sourceScreenshotPath?resolveSource(source.sourceScreenshotPath):undefined;
    if(!sourcePath&&source.sourceEvidencePath){try{const packet=JSON.parse(await readFile(source.sourceEvidencePath,'utf8'));if(typeof packet.screenshotPath==='string')sourcePath=packet.screenshotPath;}catch{/* Named gap below; no inferred image. */}}
    if(!sourcePath){add('visual-source-screenshot-missing','Source viewport has no frozen screenshot; DOM checks cannot substitute for pixels',source.name);continue;}
    let sourceImage:Awaited<ReturnType<typeof imageInfo>>,targetImage:Awaited<ReturnType<typeof imageInfo>>;
    try{[sourceImage,targetImage]=await Promise.all([imageInfo(sourcePath),imageInfo(target.screenshotPath)]);}catch{add('visual-screenshot-unreadable','Source or target screenshot bytes could not be read',source.name);continue;}
    const sourceEvidence=known.get(path.resolve(sourcePath).toLowerCase());
    if(!sourceEvidence||sourceEvidence.sha256!==sourceImage.sha256){add('visual-source-screenshot-unfrozen','Source screenshot is absent from the frozen byte-hash evidence or its bytes changed',source.name);continue;}
    const facts=source.deviceFacts,targetFacts=target.deviceFacts;
    if(!facts||!targetFacts||!Number.isFinite(facts.devicePixelRatio)||!Number.isFinite(facts.clientWidth)||!Number.isFinite(facts.innerWidth)||typeof facts.touch!=='boolean'||typeof facts.coarsePointer!=='boolean')add('visual-environment-unobserved','Source and target must both record actual device pixel ratio, client width, touch and pointer facts',source.name);
    else if(source.width!==target.width||facts.devicePixelRatio!==targetFacts.devicePixelRatio||facts.clientWidth!==targetFacts.clientWidth||facts.touch!==targetFacts.touch||facts.coarsePointer!==targetFacts.coarsePointer)add('visual-environment-incompatible','Source and target screenshots have incompatible observed width, pixel ratio or pointer environments; comparison is diagnostic only',source.name);
    let sourceCapture:unknown;
    if(source.sourceEvidencePath){try{const file=resolveSource(source.sourceEvidencePath),bytes=await readFile(file);if(known.get(file.toLowerCase())?.sha256===digest(bytes))sourceCapture=JSON.parse(bytes.toString('utf8')).screenshotCapture;}catch{/* Unfrozen receipt cannot change coordinate scale. */}}
    const sourceShot=sourceCapture as {passed?:boolean;documentLayoutPreserved?:boolean;complete?:boolean;seamless?:boolean;gaps?:Array<{code?:string;message?:string}>}|undefined;
    if(sourceShot){
      if(sourceShot.passed!==true||sourceShot.documentLayoutPreserved!==true||sourceShot.complete!==true||sourceShot.seamless!==true)add('visual-source-screenshot-not-certified','Frozen source screenshot receipt has unresolved layout, frame or coverage limitations; valid raster scale alone cannot certify its pixels',source.name);
      for(const gap of sourceShot.gaps??[])if(typeof gap.code==='string'&&typeof gap.message==='string')add('visual-source-'+gap.code,gap.message,source.name);
    }
    if(target.screenshotCapture&&target.screenshotCapture.passed!==true)add('visual-target-screenshot-not-certified','Actual target screenshot retains unresolved capture limitations; raster scale alone cannot grant visual acceptance',source.name);
    const sourceRaster=observedRasterScale({receipt:sourceCapture,image:sourceImage,facts}),targetRaster=observedRasterScale({receipt:target.screenshotCapture,image:targetImage,facts:targetFacts});
    for(const gap of sourceRaster.gaps)add('visual-source-'+gap.code,gap.message,source.name);
    for(const gap of targetRaster.gaps)add('visual-target-'+gap.code,gap.message,source.name);
    const scale=sourceRaster.scale,targetScale=targetRaster.scale;
    const pixels=(rect:VisualRect,dpr:number)=>({x:rect.x*dpr,y:rect.y*dpr,width:rect.width*dpr,height:rect.height*dpr});
    let sceneItems:Array<{id:string;kind:string;visible:boolean;rect:PresentationRect}>=[];
    if(source.sourceEvidencePath){
      try{const evidencePath=resolveSource(source.sourceEvidencePath),attestation=known.get(evidencePath.toLowerCase()),bytes=await readFile(evidencePath);
        if(attestation?.sha256===digest(bytes)){const document=JSON.parse(bytes.toString('utf8'));if(Array.isArray(document.sceneInventory?.items))sceneItems=document.sceneInventory.items;}
      }catch{/* Original packet origins remain available; absent scene facts are never invented. */}
    }
    for(const[index,block]of options.contract.blocks.entries()){
      const rootKey=options.program.blocks[index]?.rootKey,targetRoot=target.elements.find(element=>element.sourceId===rootKey);
      const sourceRoots=options.sourcePackets.filter(packet=>packet.viewport===source.name).flatMap(packet=>packet.blocks.filter(item=>item.id===block.id&&finite(item.rect)).map(item=>({rect:item.rect!,evidence:packet.evidencePath})));
      if(!sourceRoots.length)for(const binding of options.contract.sourceSceneBindings??[]){
        if(binding.viewport!==source.name||binding.blockId!==block.id||binding.targetKey!==rootKey||binding.requirement!=='block')continue;
        const item=sceneItems.find(item=>item.id===binding.sourceId&&item.kind==='block'&&item.visible&&finite(item.rect));
        if(item)sourceRoots.push({rect:item.rect,evidence:source.sourceEvidencePath!});
      }
      const uniqueRoots=[...new Map(sourceRoots.map(root=>[JSON.stringify(root.rect),root])).values()];
      const origin=uniqueRoots.length===1?uniqueRoots[0]:undefined,details=block.presentationDetails?.viewports[source.name];
      if(!origin||!targetRoot?.found||targetRoot.count!==1||!finite(targetRoot.rect)){
        add('visual-block-origin-unverified','Pixel comparison requires one observed source block origin and one actual native target owner',source.name,block.id);
        checks.push({viewport:source.name,blockId:block.id,regionId:'block',status:'unverified',evidence:sourceRoots.map(root=>root.evidence),reason:'Missing or ambiguous measured source/target block frame'});continue;
      }
      if(!details||details.status!=='observed')add('visual-presentation-unobserved','Internal presentation has not been independently frozen for this block and viewport',source.name,block.id);
      const regions=details?.status==='observed'?presentationItems(details):[];
      const candidates:Array<{id:string;visible:boolean;rect:PresentationRect;actual?:TargetPresentationEvidence}>=regions.map(region=>({id:region.id,visible:region.visible,rect:region.rect,actual:options.presentationEvidence.find(actual=>actual.viewport===source.name&&actual.blockId===block.id&&actual.id===region.id)}));
      // Root pixels catch borders/spacing omitted by the authored detail list. Dynamic content
      // remains an explicit mapping gap instead of making foreign and own product pixels equal.
      candidates.unshift({id:'block',visible:true,rect:{x:0,y:0,width:origin.rect.width,height:origin.rect.height},actual:{viewport:source.name,blockId:block.id,id:'block',found:true,count:1,visible:targetRoot.visible,rect:{x:0,y:0,width:targetRoot.rect.width,height:targetRoot.rect.height},evidence:[target.evidencePath]}});
      const dynamic=!!block.dynamicData;
      for(const region of candidates){
        const row:VisualAcceptanceReport['checks'][number]={viewport:source.name,blockId:block.id,regionId:region.id,status:'unverified',source:sourcePath,target:target.screenshotPath,evidence:[sourceEvidence.path,origin.evidence,target.evidencePath,...(region.actual?.evidence??[])]};checks.push(row);
        if(!region.visible){row.status='source-hidden';continue;}
        if(!region.actual?.found||region.actual.count!==1||region.actual.visible!==true||!finite(region.actual.rect)){
          row.status='failed';row.reason='An observed painted source region has no unique visible target region';add('visual-region-missing',row.reason,source.name,block.id,'error');continue;
        }
        const sourceRect=absolute(origin.rect,region.rect),targetRect=absolute(targetRoot.rect,region.actual.rect);
        if(dynamic){
          const controls=new Set((details?.controlGroups??[]).flatMap(group=>[group.id,...group.controls.map(control=>control.id)]));
          const staticMedia=new Set((details?.media??[]).filter(media=>!!media.assetKey&&!block.dynamicData!.replaceableAssetKeys.includes(media.assetKey!)).map(media=>media.id));
          if(!controls.has(region.id)&&!staticMedia.has(region.id)){row.reason='Dynamic content intersects this region without exact independently verified field-pixel bindings; the card, track and controls are never masked wholesale';add('visual-dynamic-field-mapping-missing',row.reason,source.name,block.id);continue;}
        }
        row.sourceRect=sourceRect;row.targetRect=targetRect;
        const tolerance={geometryPx:1,channel:Math.min(12,options.contract.tolerances.colorChannel),differentPixelRatio:region.id==='block'?.02:.01};
        const input={source:sourcePath,target:target.screenshotPath,sourceRect:pixels(sourceRect,scale),targetRect:pixels(targetRect,targetScale),tolerance,inputBytes:{source:sourceImage.bytes,target:targetImage.bytes}};
        const key=digest(JSON.stringify({version:1,comparatorSha256:comparatorSha256??null,source:sourceImage.sha256,target:targetImage.sha256,sourceRect:input.sourceRect,targetRect:input.targetRect,tolerance})),checkpoint=path.join(directory,`${key}.json`),difference=path.join(directory,`${safeLabel(source.name)}-${safeLabel(block.id)}-${safeLabel(region.id)}-${key.slice(0,12)}.png`);
        try{
          let comparison:Awaited<ReturnType<typeof compareVisualRegion>>|undefined;
          try{const saved=JSON.parse(await readFile(checkpoint,'utf8')),result=saved.result,ratio=result?.differentPixels/result?.comparedPixels,geometry=Math.abs(Math.round(input.sourceRect.width)-Math.round(input.targetRect.width))<=tolerance.geometryPx&&Math.abs(Math.round(input.sourceRect.height)-Math.round(input.targetRect.height))<=tolerance.geometryPx;
            if(comparatorSha256&&saved.comparatorSha256===comparatorSha256&&saved.version===1&&saved.key===key&&result?.sourceSha256===sourceImage.sha256&&result?.targetSha256===targetImage.sha256&&JSON.stringify(result.sourceRect)===JSON.stringify(input.sourceRect)&&JSON.stringify(result.targetRect)===JSON.stringify(input.targetRect)&&JSON.stringify(result.tolerance)===JSON.stringify(tolerance)&&result.comparedPixels>0&&Number.isFinite(ratio)&&ratio===result.differentPixelRatio&&result.maskedPixels===0&&result.geometryPassed===geometry&&result.passed===(geometry&&ratio<=tolerance.differentPixelRatio))comparison=result;
          }catch{/* Exact bytes have not been compared yet. */}
          if(comparison){row.checkpoint='reused';reusedRegions++;}else{comparison=await compareVisualRegion({...input,output:difference});await writeJson(checkpoint,{version:1,key,comparatorSha256:comparatorSha256??null,result:comparison});row.checkpoint='measured';}
          row.comparison=comparison;row.status=comparison.passed?'passed':'failed';if(!comparison.passed)add('visual-pixel-mismatch','Source and native target region pixels differ beyond the explicit local threshold; geometry is never resized to fit',source.name,block.id,'error');
        }catch{row.reason='Screenshot region could not be compared within its actual byte dimensions; no pixels were inferred or resized';add('visual-region-uncomparable',row.reason,source.name,block.id);}
      }
      if(dynamic){
        const template=details?.catalogTemplate,binding=catalogBindings.get(block.id),render=options.catalogRenders?.find(render=>render.blockId===block.id&&render.viewport===source.name),widget=target.elements.find(element=>element.sourceId===binding?.query.widgetKey),sourceItem=template?block.dynamicData!.items.find(item=>catalogTemplateOwnedBy(item,template,source.name)):undefined;
        const products=render?.products.filter(product=>(product.cardLayout?.visibleFraction??0)>=.6)??[];
        if(template&&sourceItem&&binding&&render&&widget&&products.length){
          const dataVerified=catalogRenderProblems(binding,render,widget).length===0,sourceControlRects=(details?.controlGroups??[]).flatMap(group=>group.controls.filter(control=>control.visible).map(control=>absolute(origin.rect,control.rect))),targetControlRects=(details?.controlGroups??[]).flatMap(group=>group.controls.map(control=>options.presentationEvidence.find(actual=>actual.viewport===source.name&&actual.blockId===block.id&&actual.id===control.id)).filter((actual):actual is TargetPresentationEvidence=>!!actual&&actual.visible===true&&finite(actual.rect)).map(actual=>absolute(targetRoot.rect,actual.rect!)));
          for(const product of products){
            const row:VisualAcceptanceReport['checks'][number]={viewport:source.name,blockId:block.id,regionId:`product-card-${product.id}`,status:'unverified',source:sourcePath,target:target.screenshotPath,evidence:[sourceEvidence.path,...template.evidence,...(product.cardLayout?.evidence??[]),...render.evidence]};checks.push(row);
            const layout=product.cardLayout!,layoutVerified=options.catalogRolePaint?.checks.some(check=>check.viewport===source.name&&check.blockId===block.id&&check.productId===product.id&&check.role==='card'&&check.status==='matched')===true;
            if(!dataVerified||!layoutVerified){row.reason='Exact own-product data and independently measured card/slot style must pass before dynamic field pixels may be excluded';add('visual-product-field-proof-incomplete',row.reason,source.name,block.id);continue;}
            const sourceRect=absolute(origin.rect,template.rect),targetRect=layout.rect,sourceCard={x:0,y:0,width:template.rect.width,height:template.rect.height},targetCard={x:0,y:0,width:layout.rect.width,height:layout.rect.height};
            try{
              const fields=template.slots.filter(slot=>slot.visible&&['image','name','price','rating'].includes(slot.role)).map(slot=>{
                const actual=layout.slots.find(actual=>actual.role===slot.role&&actual.visible),kind=slot.role==='name'?'product-name':slot.role;
                const authorized=slot.role==='image'?sourceItem.assetKeys.length>0:sourceItem.textIds.some(id=>block.texts.some(text=>text.id===id&&(text.kind===kind||slot.role==='name'&&['body','label','other'].includes(text.kind))));
                if(!actual||!authorized)throw Error('A visible card field lacks its exact authorized dynamic source ownership');
                return{field:slot.role as 'image'|'name'|'price'|'rating',source:slot.rect,target:actual.rect,sourceNodeId:template.sourceNodeId,targetProductId:product.id,evidence:row.evidence,dataVerified,layoutVerified,styleVerified:layoutVerified};
              });
              const relative=(rect:VisualRect,card:VisualRect)=>({x:rect.x-card.x,y:rect.y-card.y,width:rect.width,height:rect.height});
              const masks=validateDynamicPixelExclusions({sourceCard,targetCard,sourceControls:sourceControlRects.filter(rect=>overlap(rect,sourceRect)).map(rect=>relative(rect,sourceRect)),targetControls:targetControlRects.filter(rect=>overlap(rect,targetRect)).map(rect=>relative(rect,targetRect)),fields}).map(mask=>({...mask,source:pixels(mask.source,scale),target:pixels(mask.target,targetScale)}));
              const comparison=await compareVisualRegion({source:sourcePath,target:target.screenshotPath,inputBytes:{source:sourceImage.bytes,target:targetImage.bytes},sourceRect:pixels(sourceRect,scale),targetRect:pixels(targetRect,targetScale),masks,tolerance:{geometryPx:1,channel:Math.min(12,options.contract.tolerances.colorChannel),differentPixelRatio:.01},output:path.join(directory,`${safeLabel(source.name)}-${safeLabel(block.id)}-product-${product.id}.png`)});
              row.sourceRect=sourceRect;row.targetRect=targetRect;row.comparison=comparison;row.checkpoint='measured';row.status=comparison.passed?'passed':'failed';if(!comparison.passed)add('visual-product-chrome-mismatch','Product data pixels are tightly excluded after independent slot proofs, but the measured card chrome still differs',source.name,block.id,'error');
            }catch{row.reason='Dynamic field masks could not be bounded to proved source/target leaf slots without masking card chrome or controls';add('visual-product-mask-unverified',row.reason,source.name,block.id);}
          }
        }else add('visual-product-card-proof-missing','A visible source card template, authorized item ownership and actual target card slots are required for dynamic product pixel comparison',source.name,block.id);
      }
    }
  }
  if(!options.sourceViewports.length)issues.push({code:'visual-source-viewports-missing',severity:'warning',message:'No actual source viewport screenshots were available for visual acceptance'});
  const passed=checks.some(check=>check.status==='passed')&&issues.length===0&&checks.every(check=>check.status==='passed'||check.status==='source-hidden');
  const report:VisualAcceptanceReport={version:1,passed,status:passed?'passed':issues.some(issue=>issue.severity==='error')?'failed':'needs-review',checks,issues,runtime:{durationMs:Date.now()-started,comparedRegions:checks.filter(check=>check.comparison).length,reusedRegions,imageReads:imageCache.size},notice:'Pixel checks use frozen source bytes and actual native browser paint. Product data differences do not exempt card chrome, layout or controls. Missing source environments, probes, fields or regions are named gaps and cannot pass.'};
  await writeJson(path.join(directory,'report.json'),report);return report;
}
