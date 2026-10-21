import { leaseVerificationEditor, withTaskEditorWorkflow } from '../editor-completion/session.js';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium, type Browser, type Cookie, type Locator, type Page } from 'playwright';
import { writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import { assertAuthorizedEditorChanges, assertDraftHash } from '../core/runner.js';
import type { WordPressClient, DraftSnapshot, LegacySchema } from '../wordpress/client.js';
import { captureTarget, createScopedContext } from '../verification/capture-target.js';
import type{NativeCarouselClipEvidence,NativeScrollClipEvidence}from'../verification/capture-target.js';
import { verifyNativeEditor } from '../verification/editability.js';
import type { ReusableEditorCheckpoint } from './editor-checkpoint.js';
import { selectNativeWidget } from '../verification/editability.js';
import { attachEditorStartupNetwork, awaitNativeEditorReady } from '../verification/editor-readiness.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { verifyOriginalEditorSections } from '../original/verify.js';
import type { OriginalDesign, OriginalNode } from '../original/types.js';
import type { ElementBinding, TargetViewportEvidence, Viewport } from '../verification/types.js';
import type { BlockContract, NativeElement, NativeProgram } from './types.js';
import type { CompiledFidelity, FidelityImportedAsset } from './native.js';
import { flattenNative } from './check.js';
import { verifyFidelity, type FidelityStateObservation } from './verify.js';
import { compareBoundTextPaint, loadSourceTextPaint } from './text-paint.js';
import type{SourceTextPaintPacket}from'./text-paint.js';
import { catalogRenderProblems,compareCatalogRolePaint,validateTargetCatalogBindings,type CatalogRenderEvidence,type TargetCatalogEvidence } from './catalog-contract.js';
import { collectNativeCatalogRender,waitForNativeCatalogReady,type CatalogRuntimeState } from './catalog-browser.js';
import { createRuntimeTrace } from './runtime.js';
import { collectTargetPresentationEvidence } from './presentation-browser.js';
import type { TargetPresentationEvidence } from './presentation-contract.js';
import { loadSourceViewportPlan,loadSourceCoverage } from './source-coverage.js';
import { verifyVisualAcceptance } from './visual-acceptance.js';
import { fidelityCompletion,type CompletionStatus } from './completion.js';
import { sourceBrowserLaunchPlan } from './browser-environment.js';
import { navigateOwnedPreview } from '../verification/owned-preview.js';

const widgetSelector = (id: string) => { if (!/^[a-f\d]{7}$/.test(id)) throw new Error('Invalid owned native element ID'); return `[data-id="${id}"]`; };
const nextSelector = '.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"]';
const previousSelector = '.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]';
const safeMessage = (error: unknown) => redactor()(error);
function kind(type: string): string { return type === 'container' || /carousel|slider|^slides$/.test(type) ? 'container' : type === 'heading' ? 'heading' : type === 'button' ? 'button' : type === 'image' ? 'image' : 'text'; }
const verdict=(passed:boolean,failed:boolean):CompletionStatus=>passed?'passed':failed?'failed':'needs-review';

export interface ResponsiveTextBinding {blockId:string;sourceTextId:string;originalKey:string;measurementKey:string;nativeKey:string;settingPath:string;selector?:string;}
/** Measure the actual repeater title instead of a hidden heading inside its submenu. */
export function nativeBoundTitleSelector(program:NativeProgram,compiled:CompiledFidelity,schemas:Record<string,LegacySchema>,node:NativeElement):string|undefined{
  const children=schemas[node.type]?.nativeChildren;
  if(node.type!=='mega-menu'||children?.repeaterKey!=='menu_items'||children.titleSettingKey!=='item_title')return;
  const bindings=program.blocks.flatMap(block=>block.bindings).filter(binding=>binding.elementKey===node.key&&/^menu_items\.\d+\.item_title$/.test(binding.settingPath));
  if(bindings.length!==1)return;
  const row=Number(bindings[0].settingPath.split('.')[1]);
  return`${widgetSelector(compiled.elementMap[node.key])} .e-n-menu > .e-n-menu-wrapper > .e-n-menu-heading > .e-n-menu-item:nth-of-type(${row+1}) > .e-n-menu-title .e-n-menu-title-text`;
}
/** A responsive copy is allowed only inside its original block and with the same exact native setting text. */
export function responsiveTextBindings(contract:BlockContract,program:NativeProgram,compiled:CompiledFidelity,schemas:Record<string,LegacySchema>):ResponsiveTextBinding[]{
  const result:ResponsiveTextBinding[]=[];
  for(const [index,block]of contract.blocks.entries()){
    const nodes=flattenNative([program.elements[index]]);
    for(const source of block.texts){
      const binding=program.blocks[index].bindings.find(item=>item.sourceTextId===source.id);if(!binding)continue;
      const copy=nodes.find(node=>node.key===`responsive-${binding.elementKey}`&&node.type==='heading'&&String(node.settings.title??'').replace(/\s+/g,' ').trim()===source.text.replace(/\s+/g,' ').trim());
      if(copy)result.push({blockId:block.id,sourceTextId:source.id,originalKey:binding.elementKey,measurementKey:copy.key,nativeKey:copy.key,settingPath:'title'});
      if(source.kind!=='heading')continue;
      for(const node of nodes){
        const schema=schemas[node.type],children=schema?.nativeChildren;
        if(node.type!=='nested-accordion'||children?.repeaterKey!=='items'||children.titleSettingKey!=='item_title'||!Array.isArray(node.settings.items))continue;
        const items=node.settings.items as Array<Record<string,unknown>>,matches=items.map((item,row)=>({item,row})).filter(({item})=>String(item.item_title??'').replace(/\s+/g,' ').trim()===source.text.replace(/\s+/g,' ').trim());
        if(matches.length!==1)continue;
        const row=matches[0].row,measurementKey=`responsive-title:${block.id}:${source.id}:${node.key}:${row}`;
        result.push({blockId:block.id,sourceTextId:source.id,originalKey:binding.elementKey,measurementKey,nativeKey:node.key,settingPath:`items.${row}.item_title`,selector:`${widgetSelector(compiled.elementMap[node.key])} .e-n-accordion > .e-n-accordion-item:nth-of-type(${row+1}) > .e-n-accordion-item-title .e-n-accordion-item-title-text`});
      }
    }
  }
  return result;
}
/** Keep raw measurements intact; replacements carry their actual native ID/selector and a separate explicit receipt. */
export function resolveResponsiveTextMeasurements(measurements:TargetViewportEvidence[],alternatives:ResponsiveTextBinding[],packets:SourceTextPaintPacket[],contract:BlockContract){
  const receipts:Array<ResponsiveTextBinding&{viewport:string;actualTargetId?:string;evidence:string[]}> = [];
  const resolved=measurements.map(view=>({...view,elements:view.elements.map(original=>{
    if(original.visible||!original.found||!original.nativeElement)return original;
    const candidates=alternatives.filter(binding=>binding.originalKey===original.sourceId).filter(binding=>{
      const expected=contract.blocks.find(block=>block.id===binding.blockId)?.texts.find(text=>text.id===binding.sourceTextId)?.text;
      if(!expected)return false;const normalized=expected.replace(/\s+/g,' ').trim();
      return packets.filter(packet=>packet.viewport===view.name).some(packet=>packet.blocks.find(block=>block.id===binding.blockId)?.textAtoms.some(atom=>atom.visible===true&&atom.rect&&atom.rect.width>0&&atom.rect.height>0&&[atom.text,atom.fullElementText].some(text=>text?.replace(/\s+/g,' ').trim()===normalized)));
    }).map(binding=>({binding,actual:view.elements.find(element=>element.sourceId===binding.measurementKey)})).filter(({actual})=>actual?.found&&actual.nativeElement&&actual.visible&&actual.count===1);
    if(candidates.length!==1)return original;
    const{binding,actual}=candidates[0],expected=contract.blocks.find(block=>block.id===binding.blockId)!.texts.find(text=>text.id===binding.sourceTextId)!.text.replace(/\s+/g,' ').trim();
    if(actual!.text.replace(/\s+/g,' ').trim()!==expected)return original;
    receipts.push({...binding,viewport:view.name,actualTargetId:actual!.targetId,evidence:[view.evidencePath,...packets.filter(packet=>packet.viewport===view.name).map(packet=>packet.evidencePath)]});
    return{...actual!,sourceId:original.sourceId};
  })}));
  return{measurements:resolved,receipts};
}

export interface NativeBackgroundMediaReport{version:1;passed:boolean;checks:Array<{viewport:string;elementKey:string;control:string;assetKey:string;attachmentId?:number;expectedURL?:string;actualURLs:string[];registeredMedia:boolean;savedMedia:boolean;nativeElement:boolean;cssPaintConfirmed:boolean;status:'verified'|'failed';reason?:string}>;}
const backgroundURLs=(css:string)=>[...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)].map(match=>match[1]??match[2]??match[3]).filter(Boolean);
/** The native Style media field, compiled attachment identity and this exact container's browser paint must all agree. */
export function verifyNativeBackgroundMedia(program:NativeProgram,compiled:CompiledFidelity,schemas:Record<string,LegacySchema>,assets:FidelityImportedAsset[],measurements:TargetViewportEvidence[]):NativeBackgroundMediaReport{
  const checks:NativeBackgroundMediaReport['checks']=[];
  for(const view of measurements)for(const node of flattenNative(program.elements)){
    const responsive=view.name==='tablet'?'background_image_tablet':view.name==='mobile'?'background_image_mobile':'background_image';
    const hasResponsive=node.settings[responsive]&&typeof node.settings[responsive]==='object'&&'$asset'in(node.settings[responsive]as object),control=hasResponsive?responsive:'background_image',setting=node.settings[control];
    if(!setting||typeof setting!=='object'||!('$asset'in setting))continue;
    const assetKey=String((setting as{$asset:unknown}).$asset),asset=assets.find(asset=>asset.key===assetKey),saved=findSaved(compiled.composition.elements,compiled.elementMap[node.key]),savedSetting=saved?.settings[control]as{url?:unknown;id?:unknown}|undefined,actual=view.elements.find(element=>element.sourceId===node.key);
    const actualURLs=backgroundURLs(actual?.style['background-image']??'none'),registeredMedia=schemas[node.type]?.controls[control]?.type==='media',savedMedia=!!asset&&savedSetting?.url===asset.url&&savedSetting?.id===asset.attachmentId,nativeElement=!!actual?.found&&actual.nativeElement&&actual.count===1,cssPaintConfirmed=!!asset&&actualURLs.includes(asset.url)&&(actual?.media??[]).some(media=>media.origin==='background'&&media.url===asset.url);
    const verified=registeredMedia&&savedMedia&&nativeElement&&cssPaintConfirmed;
    checks.push({viewport:view.name,elementKey:node.key,control,assetKey,attachmentId:asset?.attachmentId,expectedURL:asset?.url,actualURLs,registeredMedia,savedMedia,nativeElement,cssPaintConfirmed,status:verified?'verified':'failed',reason:verified?undefined:'Registered native media, compiled attachment, canonical container or its own actual CSS background URL does not match'});
  }
  return{version:1,passed:checks.every(check=>check.status==='verified'),checks};
}

export async function carouselState(widget: Locator) {
  return widget.evaluate(element => {
    const track = element.querySelector('.swiper-wrapper,.slick-track');
    const windowElement = element.querySelector('.swiper,.swiper-container,.slick-list') ?? element;
    const windowBox = windowElement.getBoundingClientRect();
    const slides = Array.from(track?.children ?? []).filter(slide => slide.matches('.swiper-slide,.slick-slide'));
    const original = slides.filter(slide => !slide.closest('.swiper-slide-duplicate,.slick-cloned'));
    const sourceIndices = new Set(original.map(slide => slide.getAttribute('data-swiper-slide-index') ?? slide.getAttribute('data-slick-index')).filter((index):index is string=>index!==null));
    const physicalVisible = slides.filter(slide => { const box = slide.getBoundingClientRect(), css = getComputedStyle(slide); return box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && box.right > windowBox.left + 2 && box.left < windowBox.right - 2; });
    const visibleWrappers = physicalVisible.map(slide => {
      const box=slide.getBoundingClientRect(),clone=!!slide.closest('.swiper-slide-duplicate,.slick-cloned'),index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');
      // A clone contributes only when its actual source index is proved among this track's originals.
      const sourceId=index!==null&&sourceIndices.has(index)?`index:${index}`:!clone?`original:${original.indexOf(slide)}`:undefined;
      return{sourceId,index,clone,classes:slide.className,rect:{x:box.x,y:box.y,width:box.width,height:box.height}};
    });
    const visibleSourceIds=[...new Set(visibleWrappers.map(wrapper=>wrapper.sourceId).filter((id):id is string=>!!id))];
    const runtime=(windowElement as HTMLElement&{swiper?:{initialized?:boolean;destroyed?:boolean;animating?:boolean;params?:{slidesPerView?:unknown};currentBreakpoint?:unknown;autoplay?:{running?:boolean;paused?:boolean}}}).swiper;
    const initialized=runtime?.initialized===true&&runtime.destroyed!==true;
    const activeSlides=slides.filter(slide=>slide.matches('.swiper-slide-active,.slick-current'));
    const activeSourceIds=[...new Set(activeSlides.map(slide=>{const index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');return index!==null&&sourceIndices.has(index)?`index:${index}`:original.includes(slide)?`original:${original.indexOf(slide)}`:undefined;}).filter((id):id is string=>!!id))];
    const activeIdentityVerified=activeSlides.length>0&&activeSlides.every(slide=>{const index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');return index!==null&&sourceIndices.has(index)||original.includes(slide);});
    const active = original.filter(slide => slide.matches('.swiper-slide-active,.slick-current')).map(slide => `${slide.getAttribute('data-swiper-slide-index') ?? slide.getAttribute('data-slick-index') ?? original.indexOf(slide)}:${slide.textContent?.trim().replace(/\s+/g, ' ').slice(0, 500)}`);
    // Keep serialized browser callbacks self-contained. A named local function can
    // acquire tsx/esbuild's module-only __name helper, absent on ordinary pages.
    const visibleControls=Array.from(element.querySelectorAll('.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"],.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]')).filter(control=>{const box=control.getBoundingClientRect();for(let ancestor:Element|null=control;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;if(ancestor===element)break;}return box.width>0&&box.height>0;});
    const next = visibleControls.find(control=>control.matches('.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"]'));
    const previous = visibleControls.find(control=>control.matches('.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]'));
    const settingsValue = element.getAttribute('data-settings'); let settings: Record<string, unknown> = {};
    try { settings = settingsValue ? JSON.parse(settingsValue) as Record<string, unknown> : {}; } catch { /* Invalid DOM declaration is not behavior proof. */ }
    const pagination = element.querySelector('.swiper-pagination,.slick-dots,.elementor-swiper-pagination');
    const transform = track ? getComputedStyle(track).transform : '';
    const transitionDuration=track?getComputedStyle(track).transitionDuration:'',transitionProperty=track?getComputedStyle(track).transitionProperty:'';
    return { slideCount: original.length, visibleSlides: visibleSourceIds.length, visibleSourceIds, visibleWrappers, visibilityVerified:visibleWrappers.every(wrapper=>!!wrapper.sourceId), activeSourceIds,activeIdentityVerified,initialized, animating:runtime?.animating===true, transitionDuration,transitionProperty,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,runtimeSlidesPerView:runtime?.params?.slidesPerView,runtimeBreakpoint:runtime?.currentBreakpoint,cssSlidesToDisplay:getComputedStyle(element).getPropertyValue('--e-n-carousel-swiper-slides-to-display'),windowRect:{x:windowBox.x,y:windowBox.y,width:windowBox.width,height:windowBox.height},active, transform, token: JSON.stringify([active, transform]), next: !!next, previous: !!previous, pagination: !!pagination, autoplayDeclared: Object.hasOwn(settings, 'autoplay') ? settings.autoplay === 'yes' : undefined,pauseOnHoverDeclared:Object.hasOwn(settings,'pause_on_hover')?settings.pause_on_hover==='yes':undefined,autoplayRunning:runtime?.autoplay?.running,autoplayPaused:runtime?.autoplay?.paused, autoplaySpeed: typeof settings.autoplay_speed === 'number' ? settings.autoplay_speed : typeof settings.autoplay_speed === 'string' && /^\d+$/.test(settings.autoplay_speed) ? Number(settings.autoplay_speed) : undefined, loopDeclared: Object.hasOwn(settings, 'infinite') ? settings.infinite === 'yes' : undefined };
  });
}
/** SSR wrappers precede real Swiper initialization; wait for a live, settled instance and proved visible source identities. */
export async function waitForNativeCarouselReady(widget:Locator,timeoutMs=20_000){
  const started=Date.now();let previous='',stable=0,lastState:Awaited<ReturnType<typeof carouselState>>|undefined;
  while(Date.now()-started<timeoutMs){
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{reject(new NativeCarouselReadinessError(lastState,Date.now()-started));},Math.max(1,timeoutMs-(Date.now()-started)));
    });
    const state=await Promise.race([carouselState(widget),deadline]).finally(()=>{if(timer)clearTimeout(timer);});
    lastState=state;
    const signature=JSON.stringify([state.visibleSourceIds,state.transform,state.windowRect,state.visibleWrappers.map(wrapper=>wrapper.rect)]);
    if(state.initialized&&!state.animating&&state.visibilityVerified&&state.visibleSlides>0&&state.windowRect.width>0&&state.windowRect.height>0){stable=signature===previous?stable+1:1;if(stable>=3)return{elapsedMs:Date.now()-started,state};}else stable=0;
    previous=signature;await widget.page().waitForTimeout(100);
  }
  throw new NativeCarouselReadinessError(lastState,Date.now()-started);
}
class NativeCarouselReadinessError extends Error{constructor(readonly lastState:Awaited<ReturnType<typeof carouselState>>|undefined,readonly elapsedMs:number){super('Native carousel did not initialize with stable, source-identified visible slides within its bounded readiness window');}}
export function sameLogicalCarouselPosition(before:Awaited<ReturnType<typeof carouselState>>,after:Awaited<ReturnType<typeof carouselState>>):boolean{
  return before.initialized&&after.initialized&&!before.animating&&!after.animating&&before.visibilityVerified&&after.visibilityVerified&&before.activeIdentityVerified&&after.activeIdentityVerified&&JSON.stringify(before.activeSourceIds)===JSON.stringify(after.activeSourceIds)&&JSON.stringify(before.visibleSourceIds)===JSON.stringify(after.visibleSourceIds);
}
/** Only real pointer movement may exercise the native, explicitly declared pause-on-hover behavior. */
async function pauseCarouselByPointer(widget:Locator,state:Awaited<ReturnType<typeof carouselState>>){
  if(state.autoplayDeclared&&state.pauseOnHoverDeclared){const window=widget.locator('.swiper,.swiper-container,.slick-list').first();const target=await selectPaintedHoverTarget(window);if(!target)throw new Error('Declared native hover-pause window has no actually painted pointer target');await target.locator.hover({position:target.position,timeout:3_000});}
}
async function paint(locator: Locator) {
  return locator.evaluate(element => {
    const css = getComputedStyle(element);
    return { color: css.color, backgroundColor: css.backgroundColor, borderColor: css.borderColor, boxShadow: css.boxShadow, textDecorationLine: css.textDecorationLine, transform: css.transform, cursor: css.cursor, opacity: css.opacity, transition: css.transition };
  });
}
/** CSS transition samples are evidence only after actual paint and finite animations stop changing. */
export async function waitForStableHoverPaint(target:Locator,timeoutMs=1500){
  const deadline=Date.now()+timeoutMs;let previous='',stable=0;
  while(Date.now()<deadline){const value=await paint(target),running=await target.evaluate(element=>element.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getComputedTiming().iterations!==Infinity)),signature=JSON.stringify(value);stable=!running&&signature===previous?stable+1:!running?1:0;if(stable>=3)return value;previous=signature;await target.page().waitForTimeout(80);}
  throw Error('Actual native hover paint did not settle within its bounded transition window');
}
/** Use the hit-tested screen coordinate; inline anchor protocol boxes can differ from their clipped DOM union box. */
export async function hoverPaintedTarget(selected:NonNullable<Awaited<ReturnType<typeof selectPaintedHoverTarget>>>){
  const actual=await selected.locator.evaluate((element,point)=>{const hit=document.elementFromPoint(point.x,point.y);return !!hit&&(hit===element||element.contains(hit));},selected.point);
  if(!actual)throw Error('The exact native hover point is no longer unobstructed');
  await selected.locator.page().mouse.move(selected.point.x,selected.point.y);
  if(!await selected.locator.evaluate(element=>element.matches(':hover')))throw Error('The actual pointer did not enter the exact native hover leaf');
}
/** DOM visibility alone includes offscreen loop copies; require a clipped, unobstructed physical pointer location. */
export async function selectPaintedHoverTarget(candidates:Locator,options:{sourceHref?:string;expectedText?:string}={}){
  const rows=await candidates.evaluateAll((elements,expected)=>elements.flatMap((element,index)=>{
    const css=getComputedStyle(element),box=element.getBoundingClientRect(),href=element instanceof HTMLAnchorElement?element.href:undefined,text=element.textContent?.replace(/\s+/g,' ').trim()??'';
    if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||Number(css.opacity)===0||css.pointerEvents==='none'||box.width<=0||box.height<=0||expected.sourceHref!==undefined&&href!==expected.sourceHref||expected.expectedText!==undefined&&text!==expected.expectedText)return[];
    let left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
    for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor),clip=ancestor.getBoundingClientRect();if(/^(hidden|clip|auto|scroll)$/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/^(hidden|clip|auto|scroll)$/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return[];}
    if(right-left<2||bottom-top<2)return[];
    for(const [fx,fy]of[[0.5,0.5],[0.25,0.5],[0.75,0.5],[0.5,0.25],[0.5,0.75]]){const x=left+(right-left)*fx,y=top+(bottom-top)*fy,hit=document.elementFromPoint(x,y);if(hit&&(hit===element||element.contains(hit)))return[{index,position:{x:x-box.left,y:y-box.top},point:{x,y},targetId:element.closest('[data-id]')?.getAttribute('data-id')??undefined,href,text,clone:!!element.closest('.swiper-slide-duplicate,.slick-cloned'),rect:{x:box.x,y:box.y,width:box.width,height:box.height},clip:{left,right,top,bottom}}];}
    return[];
  }),options);
  const selected=rows[0];return selected?{...selected,locator:candidates.nth(selected.index)}:undefined;
}
function chosenHoverNode(source: BlockContract['blocks'][number], program: NativeProgram, blockIndex: number): { key: string; suffix: string; subject: string } {
  const properties = source.states.hover.properties ?? {}, subject = String(properties.subject ?? (source.role === 'products' ? 'product-link' : 'button'));
  const elements = flattenNative([program.elements[blockIndex]]);
  if (typeof properties.sourceTextId === 'string') {
    const binding = program.blocks[blockIndex].bindings.find(item=>item.sourceTextId===properties.sourceTextId);
    const node = binding ? elements.find(element=>element.key===binding.elementKey) : undefined;
    if (!binding || !node) throw new Error('Source hover text identity has no corresponding native block binding');
    return { key: node.key, suffix: node.type === 'image' ? 'img' : node.type === 'heading' ? 'a,.elementor-heading-title' : node.type === 'button' ? 'a,button,.elementor-button' : 'a,p', subject };
  }
  if(typeof properties.sourceHref==='string'){
    const matches=elements.filter(element=>element.settings.link&&typeof element.settings.link==='object'&&(element.settings.link as{url?:unknown}).url===properties.sourceHref);
    const node=/button/.test(subject)?matches.find(element=>element.type==='button')??matches[0]:matches[0];
    if(!node)throw new Error('Source hover URL has no corresponding native block link');
    return {key:node.key,suffix:'a',subject};
  }
  if (/arrow.*next|next.*arrow/.test(subject)) { const carousel = elements.find(item => /carousel|slider|^slides$/.test(item.type)); if (carousel) return { key: carousel.key, suffix: nextSelector, subject }; }
  if (/arrow.*prev|prev.*arrow/.test(subject)) { const carousel = elements.find(item => /carousel|slider|^slides$/.test(item.type)); if (carousel) return { key: carousel.key, suffix: previousSelector, subject }; }
  if (/product.*link|product.*name/.test(subject)) {
    const text = source.texts.find(item => item.kind === 'product-name'), binding = program.blocks[blockIndex].bindings.find(item => item.sourceTextId === text?.id);
    if (binding) return { key: binding.elementKey, suffix: 'a,.elementor-heading-title', subject };
  }
  if (/image|logo|brand/.test(subject)) { const image = elements.find(item => item.type === 'image'); if (image) return { key: image.key, suffix: 'img', subject }; }
  if (/card/.test(subject)) { const carousel = elements.find(item => /carousel|slider|^slides$/.test(item.type)); if (carousel?.children?.[0]) return { key: carousel.children[0].key, suffix: '', subject }; }
  const button = elements.find(item => item.type === 'button');
  if (button) return { key: button.key, suffix: 'a,button,.elementor-button', subject };
  const heading = elements.find(item => item.type === 'heading');
  return { key: heading?.key ?? program.elements[blockIndex].key, suffix: heading ? 'a,.elementor-heading-title' : '', subject };
}
export interface FidelityPageStateReceipt {
  viewport: string; documentWidth: number; viewportWidth: number;
  observations: FidelityStateObservation[];
  carousels: Array<{ blockId: string; key: string; targetId: string; before?: Awaited<ReturnType<typeof carouselState>>; after?: Awaited<ReturnType<typeof carouselState>>; restoredState?:Awaited<ReturnType<typeof carouselState>>;failureState?:Awaited<ReturnType<typeof carouselState>>;readinessElapsedMs?:number;clicked: boolean; dragged?: boolean; swipeChanged?: boolean; inactiveAtViewport?: boolean; moved: boolean; restored: boolean; allSlidesFit?: boolean; error?: string }>;
  hovers: Array<{ blockId: string; key: string; before?: Awaited<ReturnType<typeof paint>>; after?: Awaited<ReturnType<typeof paint>>; target?:{targetId?:string;href?:string;text:string;clone:boolean;point:{x:number;y:number};rect:{x:number;y:number;width:number;height:number};clip:{left:number;right:number;top:number;bottom:number}};hovered: boolean; restored: boolean; screenshot?: string; error?: string }>;
  aliases?:Array<{elementKey:string;targetId:string;rawCount:number;logicalCount:number;cloneCount:number;cloneKinds:string[]}>;
  unrequestedLazyRows?:Array<{url:string;src:string;currentSrc:string;loading:string;naturalWidth:number;naturalHeight:number;complete:boolean;rect:{x:number;y:number;width:number;height:number};outsideViewportHorizontal:boolean;outsideCarouselHorizontal:boolean;clone:boolean}>;
  horizontalScrollClips?:Array<{elementKey:string;targetId:string;ancestorId:string;ancestorSelector:string;overflowX:string;ancestorRect:{x:number;y:number;width:number;height:number};childRect:{x:number;y:number;width:number;height:number};scrollWidth:number;clientWidth:number;documentWidth:number;viewportWidth:number;blockId:string;sourceStatus?:'observed'|'unverified';sourceEvidence?:string[];sourceGap?:string}>;
  catalogRenders?:CatalogRenderEvidence[];
  catalogInteractions?:Array<{blockId:string;widgetKey:string;targetId:string;before?:CatalogRuntimeState;after?:CatalogRuntimeState;restoredState?:CatalogRuntimeState;clicked:boolean;dragged:boolean;moved:boolean;restored:boolean;allSlidesFit:boolean;error?:string}>;
}

const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(child => JSON.parse(canonical(child))) : Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,child]) => [key,JSON.parse(canonical(child))])) : value);
function nativeSavedElements(nodes: DraftSnapshot['elements']): unknown { return nodes.map(node => { const copy = { ...node, elements: nativeSavedElements(node.elements ?? []) }; if (!copy.isInner) delete copy.isInner; return copy; }); }
function findSaved(nodes: DraftSnapshot['elements'], id: string): DraftSnapshot['elements'][number] | undefined { for (const node of nodes) { if (node.id === id) return node; const child = findSaved(node.elements ?? [], id); if (child) return child; } }
/** A carousel UI test may change exactly one registered select field; text, repeater contents, structure and other human edits remain protected. */
export function assertAuthorizedCarouselChange(before: DraftSnapshot, current: DraftSnapshot, edit: { targetId: string; setting: 'slides_to_show'; value: string }, schemas: Record<string, LegacySchema>): void {
  if (before.pageId !== current.pageId || before.runId !== current.runId || before.status !== current.status || before.title !== current.title || canonical(before.settings) !== canonical(current.settings)) throw new Error('Owned draft changed outside its authorized carousel test');
  const patched = structuredClone(before.elements), target = findSaved(patched, edit.targetId), actual = findSaved(current.elements, edit.targetId);
  if (!target?.widgetType || !actual || !/carousel|slider|^slides$/.test(target.widgetType) || edit.setting !== 'slides_to_show') throw new Error('Only the selected native carousel display control may be changed');
  const control = schemas[target.widgetType]?.controls.slides_to_show;
  const savedValue=actual.settings.slides_to_show;
  if (control?.type !== 'select' || !control.options || !edit.value || !Object.hasOwn(control.options, edit.value) || !['string','number'].includes(typeof savedValue) || String(savedValue) !== edit.value) throw new Error('Carousel UI readback does not match its registered select value');
  target.settings.slides_to_show = savedValue;
  const normalized = compileEditorElements(patched, schemas);
  const checkFlags = (nodes: DraftSnapshot['elements'], depth: number) => { for (const node of nodes) { if (node.elType === 'container' && Boolean(node.isInner) !== (depth > 0)) throw new Error('Carousel editor test changed native nesting'); checkFlags(node.elements ?? [],depth+1); } }; checkFlags(current.elements,0);
  if (canonical(nativeSavedElements(normalized)) !== canonical(nativeSavedElements(current.elements))) throw new Error('Carousel test cannot restore unrelated document or repeater edits');
}
/** Query UI may change exactly one registered count, never product records, other controls or source structure. */
export function assertAuthorizedCatalogQueryChange(before:DraftSnapshot,current:DraftSnapshot,edit:{targetId:string;value:number},schemas:Record<string,LegacySchema>){
  if(before.pageId!==current.pageId||before.runId!==current.runId||before.status!==current.status||before.title!==current.title||canonical(before.settings)!==canonical(current.settings))throw Error('Owned draft changed outside its authorized native product query test');
  const patched=structuredClone(before.elements),target=findSaved(patched,edit.targetId),actual=findSaved(current.elements,edit.targetId),control=schemas.wd_products?.controls.items_per_page;
  const hasSavedValue=actual&&Object.hasOwn(actual.settings,'items_per_page'),savedValue=hasSavedValue?actual!.settings.items_per_page:control?.default;
  if(target?.widgetType!=='wd_products'||actual?.widgetType!=='wd_products'||control?.type!=='number'||!Number.isInteger(edit.value)||edit.value<1||!['number','string'].includes(typeof savedValue)||Number(savedValue)!==edit.value)throw Error('Only the exact registered native product items_per_page value may change');
  const beforeValue=Number(target.settings.items_per_page??control.default);if(!Number.isInteger(beforeValue)||beforeValue<1||edit.value!==beforeValue+1)throw Error('Only one explicitly tested native product count increment is authorized');
  target.settings.items_per_page=savedValue;
  const flags=(left:DraftSnapshot['elements'],right:DraftSnapshot['elements'])=>{if(left.length!==right.length)throw Error('Native product query changed child order or structure');left.forEach((node,index)=>{if(node.id!==right[index]?.id||Boolean(node.isInner)!==Boolean(right[index].isInner))throw Error('Native product query changed native identity or nesting');flags(node.elements??[],right[index].elements??[]);});};flags(patched,current.elements);
  if(canonical(nativeSavedElements(compileEditorElements(patched,schemas)))!==canonical(nativeSavedElements(compileEditorElements(current.elements,schemas))))throw Error('Native product query test cannot restore unrelated controls, document or human changes');
}

async function saveCarouselDraft(page: Page, beforeClick?:()=>void): Promise<void> {
  const label = /^(Save Draft|保存草稿|儲存草稿)$/;
  let draft = page.locator('[role="menuitem"]:visible').filter({ hasText: label }).first();
  let classic = page.locator('#elementor-panel-saver-menu-save-draft:visible').or(page.getByRole('button',{name:label})).first();
  if (!await draft.isVisible() && !await classic.isVisible()) { const menu = page.locator('#elementor-panel-saver-button-save-options,[aria-label="Save Options"],[aria-label="Save options"],[aria-label="保存选项"],[aria-label="儲存選項"]').first(); if (await menu.isVisible()) await menu.click(); }
  draft = page.locator('[role="menuitem"]:visible').filter({hasText:label}).first(); classic = page.locator('#elementor-panel-saver-menu-save-draft:visible').or(page.getByRole('button',{name:label})).first();
  if (await draft.isVisible()) { beforeClick?.();await draft.click({timeout:15_000}); return; }
  if (await classic.isVisible()) { beforeClick?.();await classic.click({timeout:15_000}); return; }
  const update = page.getByRole('button',{name:/^(Update|Save Changes|更新|保存更改|保存修改|儲存變更)$/i}).first();
  if (await update.isVisible()) { beforeClick?.();await update.click({timeout:15_000}); return; }
  throw new Error('A safe Save Draft or Update control was unavailable; Publish was not used');
}
export interface FidelityCarouselEditorReport {
  version: 1; passed: boolean; panels: Array<{ key: string; targetId: string; selected: boolean; nativeWidget: boolean; controls: string[]; repeaterKey?: string; repeaterRows: number; expectedRows: number; screenshot?: string; error?: string }>;
  check?: { key: string; targetId: string; setting: 'slides_to_show'; beforeValue: unknown; changedValue: string; changed: boolean; saved: boolean; readbackConfirmed: boolean; frontendConfirmed: boolean; restored: boolean; beforeVisibleSlides?: number; afterVisibleSlides?: number; restoredVisibleSlides?: number; beforeState?:Awaited<ReturnType<typeof carouselState>>;afterState?:Awaited<ReturnType<typeof carouselState>>;restoredState?:Awaited<ReturnType<typeof carouselState>> };
  issues: string[]; restoredHash?: string;
}

export async function readNativeCarouselEditorControl(page:Page){
  return page.evaluate(()=>{
    const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{get?:(key:string)=>unknown;id?:string}}};getContainer?:(id:string)=>{id?:string;settings?:{get?:(key:string)=>unknown};panel?:{getControlView?:(name:string)=>{container?:{id?:string};getControlValue?:()=>unknown}}};saver?:{isEditorChanged?:()=>boolean}}}).elementor;
    const model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model;
    const settings=model?.get?.('settings')as{get?:(key:string)=>unknown}|undefined;
    const modelId=String(model?.get?.('id')??model?.id??''),container=elementor?.getContainer?.(modelId),control=container?.panel?.getControlView?.('slides_to_show');
    const select=document.querySelector<HTMLSelectElement>('#elementor-panel .elementor-control-slides_to_show select[data-setting="slides_to_show"]');
    let dirty:boolean|undefined;try{dirty=elementor?.saver?.isEditorChanged?.();}catch{/* Missing or still initializing legacy saver. */}
    return{modelId,modelValue:settings?.get?.('slides_to_show'),containerId:container?.id,containerValue:container?.settings?.get?.('slides_to_show'),controlContainerId:control?.container?.id,controlModelValue:control?.getControlValue?.(),controlValue:select?.value,selectProperties:select?{id:select.id,classes:select.className,disabled:select.disabled,options:Array.from(select.options).map(option=>({value:option.value,selected:option.selected,disabled:option.disabled}))}:undefined,deviceClasses:Array.from(document.body.classList).filter(name=>name.startsWith('elementor-device-')),dirty,saveControls:Array.from(document.querySelectorAll('button,[role="menuitem"]')).filter(element=>/^(Save Draft|保存草稿|儲存草稿|Update|更新)$/.test(element.textContent?.trim()??'')).map(element=>({label:element.textContent?.trim(),disabled:(element as HTMLButtonElement).disabled,ariaDisabled:element.getAttribute('aria-disabled'),classes:element.className}))};
  });
}
export async function waitForNativeCarouselPanel(page:Page,targetId:string,value?:string,timeoutMs=15_000){
  await page.waitForFunction(({id,expected})=>{
    try{
      const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{get?:(key:string)=>unknown;id?:string}}};getContainer?:(id:string)=>{id?:string;settings?:{get?:(key:string)=>unknown}}}}).elementor;
      const model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model,settings=model?.get?.('settings')as{get?:(key:string)=>unknown}|undefined;
      const hasContainerAPI=typeof elementor?.getContainer==='function',container=elementor?.getContainer?.(id),modelValue=container?container.settings?.get?.('slides_to_show'):settings?.get?.('slides_to_show');
      const select=document.querySelector<HTMLSelectElement>('#elementor-panel .elementor-control-slides_to_show select[data-setting="slides_to_show"]');
      return String(model?.get?.('id')??model?.id??'')===id&&(!hasContainerAPI||container?.id===id)&&!!select&&(expected===undefined||select.value===expected&&String(modelValue)===expected);
    }catch{return false;}
  },{id:targetId,expected:value},{timeout:timeoutMs});
  return readNativeCarouselEditorControl(page);
}
export async function chooseNativeCarouselOption(select:Locator,value:string){
  const enabled=await select.locator('option').evaluateAll(options=>options.filter(option=>!(option as HTMLOptionElement).disabled).map(option=>(option as HTMLOptionElement).value));
  const index=enabled.indexOf(value);if(index<0)throw new Error('The registered native carousel option is not enabled in its actual select');
  await select.focus();await select.press('Home');for(let step=0;step<index;step++)await select.press('ArrowDown');await select.press('Enter');await select.press('Tab');
  if(await select.inputValue()!==value)throw new Error('Actual keyboard selection did not choose the registered native carousel value');
}

/** Closing a page cannot cancel PHP already saving its document. Observe real POST completion before restoration. */
export function trackNativeEditorPosts(page:Page){
  const pending=new Set<unknown>(),events:Array<{event:string;at:string;location:string;actions:string[];status?:number}>=[];
  let lastActivity=Date.now(),saveClickAt=0;const origin=new URL(page.url()).origin;
  const describe=(request:import('playwright').Request)=>{
    const url=new URL(request.url());if(request.method()!=='POST'||url.origin!==origin)return;
    let actions:string[]=[];try{const form=new URLSearchParams(request.postData()??''),payload=JSON.parse(form.get('actions')??'{}');actions=Object.values(payload).map(value=>value&&typeof value==='object'?(value as{action?:unknown}).action:undefined).filter((name):name is string=>typeof name==='string'&&/^[a-z0-9_/-]{1,80}$/i.test(name));}catch{/* Never retain private POST data. */}
    return{location:url.origin+url.pathname,actions};
  };
  page.on('request',request=>{const info=describe(request);if(info){pending.add(request);lastActivity=Date.now();events.push({event:'started',at:new Date().toISOString(),...info});}});
  page.on('requestfinished',request=>{const info=describe(request);if(info){pending.delete(request);lastActivity=Date.now();events.push({event:'finished',at:new Date().toISOString(),...info});}});
  page.on('requestfailed',request=>{const info=describe(request);if(info){pending.delete(request);lastActivity=Date.now();events.push({event:'failed',at:new Date().toISOString(),...info});}});
  return{events,pendingCount:()=>pending.size,markSaveClick(){saveClickAt=Date.now();lastActivity=saveClickAt;},async waitForQuiet(timeoutMs=120_000){const started=Date.now();while(Date.now()-started<timeoutMs){const finishedSave=!saveClickAt||events.some(event=>event.event==='finished'&&Date.parse(event.at)>=saveClickAt&&(event.actions.some(action=>/^(save_builder|save_document|document_save|documents?\/save(?:\/save)?)$/.test(action))||/\/elementor\/.*\/save(?:\/|$)/.test(event.location)));if(finishedSave&&pending.size===0&&Date.now()-lastActivity>=600){if(events.some(event=>event.event==='failed'))throw new Error('Native editor POST failed; server-side save completion is not proved');return;}await page.waitForTimeout(100);}throw new Error('Native editor save POST did not finish before the bounded save/restoration deadline');}};
}

export interface CatalogQueryEditorReport{
  version:1;passed:boolean;panels:Array<{blockId:string;key:string;targetId:string;selected:boolean;nativeWidget:boolean;queryControls:string[];layoutControls:string[];carouselControls?:string[];layoutScreenshot?:string;screenshot?:string;error?:string}>;
  check?:{key:string;targetId:string;setting:'items_per_page';beforeValue:number;changedValue:number;changed:boolean;saved:boolean;readbackConfirmed:boolean;frontendConfirmed:boolean;restored:boolean;beforeCount?:number;afterCount?:number;restoredCount?:number};issues:string[];restoredHash?:string;
}
/** Read the authoritative native container; panel display models may lag a genuine input event. */
export async function readNativeProductQueryControl(page:Page,name:'items_per_page'|'post_type'='items_per_page'){
  return page.evaluate(setting=>{
    const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{id?:string;get?:(name:string)=>unknown}}};getContainer?:(id:string)=>{id?:string;settings?:{get?:(name:string)=>unknown}};saver?:{isEditorChanged?:()=>boolean}}}).elementor,model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model,modelId=String(model?.get?.('id')??model?.id??''),container=elementor?.getContainer?.(modelId),control=document.querySelector<HTMLInputElement|HTMLSelectElement>(`#elementor-panel [data-setting="${setting}"]`);
    return{modelId,containerId:container?.id,containerValue:container?.settings?.get?.(setting),controlValue:control?.value,controlType:control?.tagName.toLowerCase(),dirty:elementor?.saver?.isEditorChanged?.()};
  },name);
}
export async function waitForNativeProductQueryControl(page:Page,targetId:string,value?:number,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;let state=await readNativeProductQueryControl(page);
  while(Date.now()<deadline){if(state.modelId===targetId&&state.containerId===targetId&&state.controlType==='input'&&(value===undefined||Number(state.controlValue)===value&&Number(state.containerValue)===value))return state;await page.waitForTimeout(100);state=await readNativeProductQueryControl(page);}
  throw Error('The exact native product query input and authoritative container did not acknowledge its value');
}
/** Woodmart registers count under Layout and the slider under its independent Carousel section. */
export async function exposeNativeProductQuerySection(page:Page,targetId:string,section:'layout_style_section'|'carousel_style_section',control:'items_per_page'|'slides_per_view',schema:LegacySchema){
  if(schema.type!=='wd_products'||schema.controls[section]?.type!=='section'||schema.controls[control]?.type!==(control==='items_per_page'?'number':'slider'))throw Error('Native query section and control are not registered in the current widget');
  await page.waitForFunction(id=>{const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{id?:string;get?:(key:string)=>unknown}}};getContainer?:(id:string)=>{id?:string}}}).elementor,model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model;return String(model?.get?.('id')??model?.id??'')===id&&elementor?.getContainer?.(id)?.id===id;},targetId,{timeout:15000});
  const group=page.locator(`#elementor-panel .elementor-control-${control}`).first();
  if(!await group.isVisible()){const header=page.locator(`#elementor-panel .elementor-control-${section} .elementor-panel-heading`).first();await header.waitFor({state:'visible',timeout:5000});await header.click({timeout:5000});}
  await group.waitFor({state:'visible',timeout:5000});await group.locator('input:visible').first().waitFor({state:'visible',timeout:5000});
  return{section,control,modelId:targetId,inputs:await group.locator('input:visible').evaluateAll(inputs=>inputs.map(input=>({setting:input.getAttribute('data-setting'),type:(input as HTMLInputElement).type,value:(input as HTMLInputElement).value})))};
}

/** Five native queries remain independently selectable; one genuine count edit must save, render and restore exactly. */
export async function verifyCatalogQueryEditor(options:{program:NativeProgram;contract:BlockContract;compiled:CompiledFidelity;client:WordPressClient;snapshot:DraftSnapshot;schemas:Record<string,LegacySchema>;editorUrl:string;previewUrl:string;cookies:Cookie[];catalog?:TargetCatalogEvidence;runDir:string;browser?:Browser;onSnapshot?:(snapshot:DraftSnapshot)=>void}):Promise<CatalogQueryEditorReport>{
  const{program,contract,compiled,client,snapshot,schemas,editorUrl,previewUrl,cookies,runDir}=options,bindings=validateTargetCatalogBindings(contract,program),report:CatalogQueryEditorReport={version:1,passed:false,panels:[],issues:[]};
  if(!bindings.size){report.passed=true;report.restoredHash=snapshot.hash;return report;}
  if(!options.catalog?.evidence.length){report.issues.push('Actual target WooCommerce catalog proof is required for native query UI verification');return report;}
  if(snapshot.status!=='draft'||new URL(editorUrl).origin!==new URL(previewUrl).origin||new URL(editorUrl).origin!==options.catalog.targetOrigin||new URL(editorUrl).searchParams.get('post')!==String(snapshot.pageId)||new URL(editorUrl).searchParams.get('action')!=='elementor')throw Error('Native query UI verification must target the exact owned draft and catalog origin');
  const directory=path.join(runDir,'verification/catalog-query-editor');await mkdir(directory,{recursive:true});
  const ownBrowser=!options.browser,browser=options.browser??await chromium.launch({headless:true}),lease=await leaseVerificationEditor(browser,editorUrl,{cookies});const context=lease.context;let page:Page|undefined,tracker:ReturnType<typeof trackNativeEditorPosts>|undefined,mutated=false,saveSettled=true;
  const showStyle=async(editor:Page)=>{const tab=editor.locator('#elementor-panel [data-tab="style"],#elementor-panel .elementor-tab-control-style').first();await tab.click({timeout:5000});};
  const count=async(key:string,label:string)=>{const frontend=await context.newPage();try{await frontend.setViewportSize({width:1440,height:1000});await frontend.emulateMedia({reducedMotion:'no-preference'});const navigation=await navigateOwnedPreview(frontend,previewUrl);await writeJson(path.join(directory,`${label}-navigation.json`),navigation);const render=await collectNativeCatalogRender({page:frontend,blockId:label,widgetKey:key,elementId:compiled.elementMap[key],viewport:'desktop',catalog:options.catalog!,runDir:directory});
    const root=frontend.locator(widgetSelector(compiled.elementMap[key])),actual=await root.evaluate((element,mapping)=>{const box=element.getBoundingClientRect(),css=getComputedStyle(element),widgetType=element.getAttribute('data-widget_type')?.split('.')[0];return{sourceId:mapping.key,targetId:mapping.id,selector:`[data-id="${mapping.id}"]`,found:true,count:1,nativeElement:element.getAttribute('data-element_type')==='widget'&&widgetType==='wd_products',widgetType,visible:box.width>0&&box.height>0&&css.display!=='none'&&css.visibility!=='hidden',rect:{x:box.x,y:box.y,width:box.width,height:box.height},text:element.textContent??'',style:{},images:[]};},{key,id:compiled.elementMap[key]}),binding=[...bindings.values()].find(binding=>binding.query.widgetKey===key);
    if(!binding||catalogRenderProblems(binding,render,actual).length)throw Error('Actual native query rows do not match observed own WooCommerce identity, price, media and permalink');await root.scrollIntoViewIfNeeded({timeout:5000});await frontend.screenshot({path:path.join(directory,`${label}.png`),fullPage:false,timeout:5000});return new Set(render.products.map(product=>product.id)).size;}finally{await frontend.close();}};
  try{
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash,snapshot.hash);page=lease.page;const responses=attachEditorStartupNetwork(page);await page.setViewportSize({width:1440,height:1000});await lease.navigate().catch(()=>{throw Error('Owned native query editor navigation failed')});
    await awaitNativeEditorReady({page,editorUrl,rootIds:compiled.sectionIds,runDir,label:'catalog-queries',requirePanelAPI:true,responses});const frame=page.frameLocator('#elementor-preview-iframe');
    for(const[blockId,binding]of bindings){
      const key=binding.query.widgetKey,targetId=compiled.elementMap[key],proof:CatalogQueryEditorReport['panels'][number]={blockId,key,targetId,selected:false,nativeWidget:false,queryControls:[],layoutControls:[]};report.panels.push(proof);
      try{const widget=frame.locator(widgetSelector(targetId)).first();proof.nativeWidget=await widget.evaluate(element=>element.getAttribute('data-widget_type')==='wd_products.default');if(!proof.nativeWidget)throw Error('Product query is not the registered native wd_products widget');await selectNativeWidget(widget,page);
        await page.waitForFunction(id=>{const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{id?:string;get?:(key:string)=>unknown}}};getContainer?:(id:string)=>{id?:string}}}).elementor,model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model;return String(model?.get?.('id')??model?.id??'')===id&&elementor?.getContainer?.(id)?.id===id;},targetId,{timeout:15000});proof.selected=true;
        const content=page.locator('#elementor-panel [data-tab="content"],#elementor-panel .elementor-tab-control-content').first();await content.click({timeout:5000});proof.queryControls=await page.locator('#elementor-panel [data-setting]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute('data-setting')??''))]);
        if(!proof.queryControls.includes('post_type'))throw Error('The actual native query panel has no registered data source control');await showStyle(page);const layout=await exposeNativeProductQuerySection(page,targetId,'layout_style_section','items_per_page',schemas.wd_products);await waitForNativeProductQueryControl(page,targetId);proof.layoutControls=await page.locator('#elementor-panel [data-setting]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute('data-setting')??''))]);
        proof.layoutScreenshot=path.join(directory,`${blockId}-layout.png`);await page.screenshot({path:proof.layoutScreenshot,fullPage:false,timeout:5000});let carousel:Awaited<ReturnType<typeof exposeNativeProductQuerySection>>|undefined;
        if(binding.query.carouselMode){carousel=await exposeNativeProductQuerySection(page,targetId,'carousel_style_section','slides_per_view',schemas.wd_products);proof.carouselControls=await page.locator('#elementor-panel [data-setting]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.getAttribute('data-setting')??''))]);proof.carouselControls.push('slides_per_view');}
        if(!proof.layoutControls.includes('items_per_page')||binding.query.carouselMode&&!proof.carouselControls?.includes('slides_per_view'))throw Error('Native query count and carousel columns controls are not exposed');await writeJson(path.join(directory,`${blockId}-sections.json`),{targetId,layout,carousel});proof.screenshot=path.join(directory,`${blockId}.png`);await page.screenshot({path:proof.screenshot,fullPage:false,timeout:5000});
      }catch(error){proof.error=safeMessage(error);report.issues.push(`${blockId}: ${proof.error}`);}
    }
    if(report.panels.some(panel=>!panel.selected||!panel.nativeWidget||panel.error))throw Error('Every native product query panel must be proved before a representative edit');
    const selected=report.panels[0],original=findSaved(snapshot.elements,selected.targetId),beforeValue=Number(original?.settings.items_per_page??schemas.wd_products?.controls.items_per_page?.default),changedValue=beforeValue+1;
    if(!Number.isInteger(beforeValue)||beforeValue<1||schemas.wd_products?.controls.items_per_page?.type!=='number'||changedValue>options.catalog.products.length)throw Error('A registered product count with enough actual own catalog rows is required');
    const check:NonNullable<CatalogQueryEditorReport['check']>={key:selected.key,targetId:selected.targetId,setting:'items_per_page',beforeValue,changedValue,changed:false,saved:false,readbackConfirmed:false,frontendConfirmed:false,restored:false};report.check=check;check.beforeCount=await count(selected.key,'before-query');if(check.beforeCount!==beforeValue)throw Error('Actual native query count does not equal the registered saved baseline');
    await selectNativeWidget(frame.locator(widgetSelector(selected.targetId)).first(),page);await showStyle(page);await exposeNativeProductQuerySection(page,selected.targetId,'layout_style_section','items_per_page',schemas.wd_products);await writeJson(path.join(directory,'control-before.json'),await waitForNativeProductQueryControl(page,selected.targetId,beforeValue));tracker=trackNativeEditorPosts(page);const input=page.locator('#elementor-panel [data-setting="items_per_page"]:visible').first();mutated=true;
    await input.focus();await input.press('ArrowUp');await input.press('Tab');const afterControl=await waitForNativeProductQueryControl(page,selected.targetId,changedValue);check.changed=true;await writeJson(path.join(directory,'control-after.json'),afterControl);
    if(afterControl.dirty!==true)throw Error('The genuine native query input did not mark the editor changed');saveSettled=false;await saveCarouselDraft(page,()=>tracker!.markSaveClick());await tracker.waitForQuiet(120000);saveSettled=true;await writeJson(path.join(directory,'save-post-lifecycle.json'),{events:tracker.events,pending:tracker.pendingCount(),finished:true});
    let modified=await client.snapshotDraft(snapshot.pageId);assertAuthorizedCatalogQueryChange(snapshot,modified,{targetId:selected.targetId,value:changedValue},schemas);const stable=[];for(let index=0;index<3;index++){modified=await client.snapshotDraft(snapshot.pageId);assertAuthorizedCatalogQueryChange(snapshot,modified,{targetId:selected.targetId,value:changedValue},schemas);stable.push(modified.hash);if(index<2)await page.waitForTimeout(750);}if(new Set(stable).size!==1)throw Error('Saved native query did not produce stable server readbacks');check.saved=true;check.readbackConfirmed=true;await writeJson(path.join(directory,'stable-readbacks.json'),stable);
    check.afterCount=await count(selected.key,'modified-query');check.frontendConfirmed=check.afterCount===changedValue&&check.afterCount!==check.beforeCount;if(!check.frontendConfirmed)throw Error('Saved native query did not change the actual rendered own-product count');
  }catch(error){report.issues.push(safeMessage(error));if(page){try{await writeJson(path.join(directory,'control-failure.json'),{error:safeMessage(error),state:await readNativeProductQueryControl(page)});}catch{/* Preserve the explicit failure without private browser network details. */}}}
  finally{
    if(tracker){try{await tracker.waitForQuiet(120000);saveSettled=true;await writeJson(path.join(directory,'save-post-lifecycle-final.json'),{events:tracker.events,pending:tracker.pendingCount(),finished:true});}catch(error){saveSettled=false;report.issues.push(safeMessage(error));}}
    if(mutated&&report.check&&!saveSettled)report.issues.push('Native query save is not settled; unchanged-hash and safe restoration success are withheld');
    else{try{const current=await client.snapshotDraft(snapshot.pageId);let restored=current;if(current.hash!==snapshot.hash){if(!report.check)throw Error('No authorized native query edit is recorded');assertAuthorizedCatalogQueryChange(snapshot,current,{targetId:report.check.targetId,value:report.check.changedValue},schemas);restored=await client.restoreDraft(snapshot.pageId,snapshot,{expectedCurrent:current});options.onSnapshot?.(restored);}assertDraftHash(restored.hash,snapshot.hash);report.restoredHash=restored.hash;if(report.check){report.check.restoredCount=await count(report.check.key,'restored-query');report.check.restored=report.check.restoredCount===report.check.beforeCount;if(!report.check.restored)throw Error('Exact restored native query did not return to its original real product count');}}catch(error){report.issues.push(safeMessage(error));}}
    await lease.release();if(ownBrowser)await browser.close();
  }
  report.passed=report.issues.length===0&&report.panels.every(panel=>panel.selected&&panel.nativeWidget)&&!!report.check?.changed&&report.check.saved&&report.check.readbackConfirmed&&report.check.frontendConfirmed&&report.check.restored;await writeJson(path.join(directory,'receipt.json'),report);return report;
}

/** Select each actual native carousel panel, then save one real display-count change and restore the exact owned document. */
export async function verifyFidelityCarouselEditor(options: { program: NativeProgram; compiled: CompiledFidelity; client: WordPressClient; snapshot: DraftSnapshot; schemas: Record<string, LegacySchema>; editorUrl: string; previewUrl: string; cookies: Cookie[]; runDir: string; browser?: Browser; onSnapshot?: (snapshot: DraftSnapshot)=>void }): Promise<FidelityCarouselEditorReport> {
  const {program,compiled,client,snapshot,schemas,editorUrl,previewUrl,cookies,runDir} = options;
  const nativeCarousels = flattenNative(program.elements).filter(node=>/carousel|slider|^slides$/.test(node.type));
  const report: FidelityCarouselEditorReport = {version:1,passed:false,panels:[],issues:[]};
  if (!nativeCarousels.length) { report.passed=true;report.restoredHash=snapshot.hash;return report; }
  const directory = path.join(runDir,'verification/carousel-editor'); await mkdir(directory,{recursive:true});
  const ownBrowser=!options.browser,browser=options.browser??await chromium.launch({headless:true});
  if (new URL(editorUrl).origin !== new URL(previewUrl).origin || new URL(editorUrl).searchParams.get('post') !== String(snapshot.pageId) || new URL(editorUrl).searchParams.get('action') !== 'elementor') { if(ownBrowser)await browser.close(); throw new Error('Carousel UI verification must target this exact owned draft editor and preview origin'); }
  const previewID = ['page_id','p','preview_id'].map(name=>new URL(previewUrl).searchParams.get(name)).find(value=>value!==null);
  if(previewID&&previewID!==String(snapshot.pageId)){if(ownBrowser)await browser.close();throw new Error('Carousel preview identity does not match its owned draft');}
  const lease=await leaseVerificationEditor(browser,editorUrl,{cookies}).catch(async error=>{if(ownBrowser)await browser.close();throw error;});const context=lease.context;let mutated=false;
  let postTracker:ReturnType<typeof trackNativeEditorPosts>|undefined,saveSettled=true,editorPage:Page|undefined;
  try {
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash,snapshot.hash);
    const page=lease.page;const startupResponses=attachEditorStartupNetwork(page);await page.setViewportSize({width:1440,height:1000});
    editorPage=page;
    await lease.navigate().catch(()=>{throw new Error('Owned carousel editor navigation failed; authentication details omitted');});
    if(new URL(page.url()).origin!==new URL(editorUrl).origin||/wp-login\.php/.test(page.url()))throw new Error('Native carousel editor did not reach its exact configured origin');
    await awaitNativeEditorReady({page,editorUrl,rootIds:compiled.sectionIds,runDir,label:'carousels',requirePanelAPI:true,responses:startupResponses}); const frame=page.frameLocator('#elementor-preview-iframe');
    if(!await page.locator('#elementor-navigator').isVisible()){const opener=page.locator('#elementor-panel-footer-navigator').or(page.getByRole('button',{name:/^(Navigator|Structure|导航器|導航器|结构|結構)$/})).first();if(await opener.isVisible())await opener.click();else await page.keyboard.press('Control+i');}
    await page.locator('#elementor-navigator').waitFor({state:'visible',timeout:10_000});
    for(const [index,node]of nativeCarousels.entries()){
      const targetId=compiled.elementMap[node.key],schema=schemas[node.type],repeaterKey=schema?.nativeChildren?.repeaterKey;
      const proof:FidelityCarouselEditorReport['panels'][number]={key:node.key,targetId,selected:false,nativeWidget:false,controls:[],repeaterKey,repeaterRows:0,expectedRows:repeaterKey&&Array.isArray(node.settings[repeaterKey])?(node.settings[repeaterKey]as unknown[]).length:0};report.panels.push(proof);
      try{
        const widget=frame.locator(widgetSelector(targetId)).first();await widget.waitFor({state:'attached',timeout:20_000});
        proof.nativeWidget=await widget.evaluate((element,type)=>element.getAttribute('data-widget_type')?.split('.')[0]===type,node.type);
        if(!proof.nativeWidget)throw new Error('Selected editor element is not the registered native carousel widget');
        await selectNativeWidget(widget,page);
        await page.waitForFunction(id=>{const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{get?:(name:string)=>unknown;id?:string}}}}}).elementor;const model=elementor?.getPanelView?.().getCurrentPageView?.().model;return String(model?.get?.('id')??model?.id??'')===id;},targetId,{timeout:10_000});proof.selected=true;
        const content=page.locator('#elementor-panel [data-tab="content"],#elementor-panel .elementor-tab-control-content').first();if(await content.isVisible())await content.click();
        proof.controls=await page.locator('#elementor-panel [data-setting]').evaluateAll(elements=>Array.from(new Set(elements.map(element=>element.getAttribute('data-setting')??'').filter(Boolean))));
        if(!proof.controls.includes('slides_to_show')&&!proof.controls.includes('autoplay'))throw new Error('Native carousel panel exposes no registered display or autoplay controls');
        if(repeaterKey){
          const group=page.locator(`#elementor-panel .elementor-control-${repeaterKey}`).first();await group.waitFor({state:'attached',timeout:5_000});
          const counts=await group.evaluate(element=>({fields:element.querySelectorAll('.elementor-repeater-fields').length,rows:element.querySelectorAll('.elementor-repeater-row').length,titles:element.querySelectorAll('.elementor-repeater-row-item-title').length}));
          proof.repeaterRows=Math.max(counts.fields,counts.rows,counts.titles);
          if(proof.repeaterRows<proof.expectedRows)throw new Error('Native carousel panel did not expose every source slide repeater row');
        }
        proof.screenshot=path.join(directory,`${String(index+1).padStart(2,'0')}-${node.key}.png`);await page.screenshot({path:proof.screenshot,fullPage:false});
      }catch(error){proof.error=safeMessage(error);report.issues.push(`${node.key}: ${proof.error}`);}
    }
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash,snapshot.hash);
    const selected=nativeCarousels.find(node=>node.children&&node.children.length>=3&&schemas[node.type]?.controls.slides_to_show?.type==='select')??nativeCarousels.find(node=>schemas[node.type]?.controls.slides_to_show?.type==='select');
    if(!selected)throw new Error('No source native carousel exposes a proven select display control');
    const targetId=compiled.elementMap[selected.key],original=findSaved(snapshot.elements,targetId),control=schemas[selected.type].controls.slides_to_show;
    if(!original||!control.options)throw new Error('Selected native carousel has no saved registered display control');
    const frontend=await context.newPage();await frontend.setViewportSize({width:1440,height:1000});await frontend.goto(previewUrl,{waitUntil:'domcontentloaded',timeout:45_000});
    if(new URL(frontend.url()).origin!==new URL(previewUrl).origin||/wp-login\.php/.test(frontend.url()))throw new Error('Carousel editor frontend confirmation did not reach its owned draft');
    const beforeWidget=frontend.locator(widgetSelector(targetId)).first();await beforeWidget.locator('.swiper-wrapper,.slick-track').first().waitFor({state:'attached',timeout:20_000});await beforeWidget.scrollIntoViewIfNeeded();
    const beforeReady=await waitForNativeCarouselReady(beforeWidget),before=beforeReady.state,beforeValue=original.settings.slides_to_show;
    await writeJson(path.join(directory,'before-frontend-state.json'),beforeReady);
    const optionsValues=Object.keys(control.options).filter(value=>/^\d+$/.test(value)&&Number(value)>0&&value!==String(beforeValue)&&Number(value)<=Math.max(before.slideCount,2));
    const preferred=String(before.visibleSlides>1?before.visibleSlides-1:2),changedValue=optionsValues.includes(preferred)?preferred:optionsValues[0];if(!changedValue)throw new Error('Native carousel has no alternate legal source-preserving display count');
    const check:NonNullable<FidelityCarouselEditorReport['check']>={key:selected.key,targetId,setting:'slides_to_show',beforeValue,changedValue,changed:false,saved:false,readbackConfirmed:false,frontendConfirmed:false,restored:false,beforeVisibleSlides:before.visibleSlides,beforeState:before};report.check=check;
    await selectNativeWidget(frame.locator(widgetSelector(targetId)).first(),page);
    await page.waitForFunction(id=>{try{const elementor=(window as unknown as{elementor?:{getPanelView?:()=>{getCurrentPageView?:()=>{model?:{get?:(key:string)=>unknown;id?:string}}}}}).elementor;const model=elementor?.getPanelView?.()?.getCurrentPageView?.()?.model;return String(model?.get?.('id')??model?.id??'')===id;}catch{return false;}},targetId,{timeout:10_000});
    const content=page.locator('#elementor-panel [data-tab="content"],#elementor-panel .elementor-tab-control-content').first();if(await content.isVisible())await content.click();
    const select=page.locator('#elementor-panel .elementor-control-slides_to_show select[data-setting="slides_to_show"]').first();await select.waitFor({state:'visible',timeout:10_000});
    const beforeControl=await waitForNativeCarouselPanel(page,targetId,String(beforeValue));await writeJson(path.join(directory,'control-before-change.json'),beforeControl);
    postTracker=trackNativeEditorPosts(page);
    const saveResponses:Array<Record<string,unknown>>=[];
    page.on('response',async response=>{
      if(!/\/wp-admin\/admin-ajax\.php$/.test(new URL(response.url()).pathname)||response.request().method()!=='POST')return;
      try{const input=new URLSearchParams(response.request().postData()??''),actions=JSON.parse(input.get('actions')??'{}'),names=Object.keys(actions).filter(name=>/^[a-z0-9_/-]{1,80}$/i.test(name));const body=await response.json()as{success?:unknown;data?:{responses?:Record<string,{success?:unknown;data?:{code?:unknown}}>}};saveResponses.push({status:response.status(),actionNames:names,success:typeof body.success==='boolean'?body.success:undefined,responses:Object.entries(body.data?.responses??{}).map(([name,item])=>({name:/^[a-z0-9_/-]{1,80}$/i.test(name)?name:'omitted',success:typeof item.success==='boolean'?item.success:undefined,code:typeof item.data?.code==='string'&&/^[a-z0-9_-]{1,80}$/i.test(item.data.code)?item.data.code:undefined}))});}catch{/* Keep private AJAX body, nonce and headers out of diagnostics. */}
    });
    mutated=true;await chooseNativeCarouselOption(select,changedValue);const afterControl=await waitForNativeCarouselPanel(page,targetId,changedValue);check.changed=true;await writeJson(path.join(directory,'control-after-change.json'),afterControl);
    if(afterControl.dirty===false){await page.waitForFunction(()=>{try{return(window as unknown as{elementor?:{saver?:{isEditorChanged?:()=>boolean}}}).elementor?.saver?.isEditorChanged?.()===true;}catch{return false;}},undefined,{timeout:15_000});await writeJson(path.join(directory,'control-dirty-confirmed.json'),await readNativeCarouselEditorControl(page));}
    await saveCarouselDraft(page,()=>postTracker!.markSaveClick());await writeJson(path.join(directory,'control-after-save-click.json'),await readNativeCarouselEditorControl(page));
    saveSettled=false;await postTracker.waitForQuiet();saveSettled=true;await writeJson(path.join(directory,'save-post-lifecycle.json'),{settled:true,pending:postTracker.pendingCount(),events:postTracker.events});
    await writeJson(path.join(directory,'control-after-save-completion.json'),await readNativeCarouselEditorControl(page));
    let modified:DraftSnapshot|undefined;const saveDeadline=Date.now()+15_000;
    while(Date.now()<saveDeadline){const current=await client.snapshotDraft(snapshot.pageId);if(String(findSaved(current.elements,targetId)?.settings.slides_to_show)===changedValue){modified=current;break;}await page.waitForTimeout(350);}
    await writeJson(path.join(directory,'save-ajax-responses.json'),saveResponses);
    if(!modified)throw new Error('Carousel display control was not persisted in the real native tree');
    const stableReadbacks:Array<{hash:string;at:string}>=[];for(let sample=0;sample<3;sample++){if(sample)await page.waitForTimeout(750);const settled=await client.snapshotDraft(snapshot.pageId);assertDraftHash(settled.hash,modified.hash);stableReadbacks.push({hash:settled.hash,at:new Date().toISOString()});}await writeJson(path.join(directory,'save-stable-server-readbacks.json'),stableReadbacks);
    assertAuthorizedCarouselChange(snapshot,modified,{targetId,setting:'slides_to_show',value:changedValue},schemas);check.saved=true;check.readbackConfirmed=true;
    await writeJson(path.join(directory,'authorized-edit.json'),{targetId,setting:'slides_to_show',value:changedValue,modifiedHash:modified.hash});
    await frontend.reload({waitUntil:'domcontentloaded',timeout:45_000});const afterWidget=frontend.locator(widgetSelector(targetId)).first();await afterWidget.locator('.swiper-wrapper,.slick-track').first().waitFor({state:'attached',timeout:20_000});await afterWidget.scrollIntoViewIfNeeded();
    const afterReady=await waitForNativeCarouselReady(afterWidget);await writeJson(path.join(directory,'modified-frontend-state.json'),afterReady);
    const visualDeadline=Date.now()+8_000;while(Date.now()<visualDeadline){const actual=await carouselState(afterWidget);check.afterState=actual;check.afterVisibleSlides=actual.visibleSlides;if(actual.initialized&&!actual.animating&&actual.visibilityVerified&&actual.visibleSlides!==before.visibleSlides){check.frontendConfirmed=true;break;}await frontend.waitForTimeout(180);}
    await frontend.screenshot({path:path.join(directory,'modified-frontend.png'),fullPage:false});
    if(!check.frontendConfirmed)throw new Error('Saved native carousel display count did not change actual frontend slide visibility');
  }catch(error){report.issues.push(safeMessage(error));if(editorPage){try{await writeJson(path.join(directory,'control-failure-state.json'),{error:safeMessage(error),state:await readNativeCarouselEditorControl(editorPage)});await editorPage.screenshot({path:path.join(directory,'control-failure.png'),fullPage:false,timeout:5_000});}catch{/* A failed editor retains its explicit failure without private network data. */}}}
  finally{
    if(postTracker){try{await postTracker.waitForQuiet();saveSettled=true;}catch(error){saveSettled=false;report.issues.push(`Save completion: ${safeMessage(error)}`);}await writeJson(path.join(directory,'save-post-lifecycle-final.json'),{settled:saveSettled,pending:postTracker.pendingCount(),events:postTracker.events});}
    await Promise.all(context.pages().map(page=>page.close()));
    if(mutated&&report.check&&!saveSettled){report.check.restored=false;report.issues.push('The editor save did not finish; restoration and unchanged-hash success are deliberately withheld');}
    else if(mutated&&report.check){
      try{
        const current=await client.snapshotDraft(snapshot.pageId);
        let restored:DraftSnapshot;
        if(current.hash===snapshot.hash)restored=current;
        else{assertAuthorizedCarouselChange(snapshot,current,{targetId:report.check.targetId,setting:'slides_to_show',value:report.check.changedValue},schemas);restored=await client.restoreDraft(snapshot.pageId,snapshot,{expectedCurrent:current});options.onSnapshot?.(restored);}
        assertDraftHash(restored.hash,snapshot.hash);report.check.restored=true;report.restoredHash=restored.hash;
        const frontend=await context.newPage();await frontend.setViewportSize({width:1440,height:1000});await frontend.goto(previewUrl,{waitUntil:'domcontentloaded',timeout:45_000});const restoredWidget=frontend.locator(widgetSelector(report.check.targetId)).first();await restoredWidget.locator('.swiper-wrapper,.slick-track').first().waitFor({state:'attached',timeout:20_000});await restoredWidget.scrollIntoViewIfNeeded();const restoredReady=await waitForNativeCarouselReady(restoredWidget);await writeJson(path.join(directory,'restored-frontend-state.json'),restoredReady);report.check.restoredState=restoredReady.state;report.check.restoredVisibleSlides=restoredReady.state.visibleSlides;
        if(report.check.restoredVisibleSlides!==report.check.beforeVisibleSlides){report.check.restored=false;throw new Error('Restored native carousel frontend did not return to its original visible slide count');}
        await frontend.screenshot({path:path.join(directory,'restored-frontend.png'),fullPage:false});await frontend.close();
      }catch(error){report.issues.push(`Carousel restoration: ${safeMessage(error)}`);}
    }else{const current=await client.snapshotDraft(snapshot.pageId);assertDraftHash(current.hash,snapshot.hash);report.restoredHash=current.hash;}
    await lease.release();if(ownBrowser)await browser.close();
  }
  report.passed=report.issues.length===0&&report.panels.every(panel=>panel.selected&&panel.nativeWidget)&&!!report.check?.saved&&report.check.readbackConfirmed&&report.check.frontendConfirmed&&report.check.restored;
  await writeJson(path.join(directory,'receipt.json'),report);return report;
}

/** Exercise actual owned frontend controls. Never click source/commerce links, submit forms or call carousel runtime methods. */
export async function inspectFidelityPage(options: { page: Page; program: NativeProgram; contract: BlockContract; compiled: CompiledFidelity; viewport: string; runDir: string;catalog?:TargetCatalogEvidence }): Promise<FidelityPageStateReceipt> {
  const { page, program, contract, compiled, viewport, runDir } = options;
  const directory = path.join(runDir, 'verification/states', viewport); await mkdir(directory, { recursive: true });
  const widths = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  const receipt: FidelityPageStateReceipt = { viewport, ...widths, observations: [], carousels: [], hovers: [] };
  const catalogBindings=contract.blocks.some(block=>block.dynamicData)||program.blocks.some(block=>block.productQuery)?validateTargetCatalogBindings(contract,program):new Map();
  for (let index = 0; index < contract.blocks.length; index++) {
    const source = contract.blocks[index], sourceProgram = program.blocks[index], root = program.elements[index];
    const catalogBinding=catalogBindings.get(source.id);
    if(catalogBinding){
      const widgetKey=catalogBinding.query.widgetKey,targetId=compiled.elementMap[widgetKey],widget=page.locator(widgetSelector(targetId));
      const proof:NonNullable<FidelityPageStateReceipt['catalogInteractions']>[number]={blockId:source.id,widgetKey,targetId,clicked:false,dragged:false,moved:false,restored:false,allSlidesFit:false};(receipt.catalogInteractions??=[]).push(proof);
      try{
        if(!options.catalog)throw Error('An actual target WooCommerce catalog is required for native product browser verification');
        await widget.scrollIntoViewIfNeeded({timeout:5000});
        const rendered=await collectNativeCatalogRender({page,blockId:source.id,widgetKey,elementId:targetId,viewport,catalog:options.catalog,runDir,carouselExpected:!!catalogBinding.query.carouselMode});(receipt.catalogRenders??=[]).push(rendered);
        if(catalogBinding.query.carouselMode){
          proof.before=await waitForNativeCatalogReady(widget);const before=proof.before;
          proof.allSlidesFit=source.geometry[viewport]?.columns!==undefined&&source.geometry[viewport].columns!>=rendered.products.length&&before.visibleIds.length===new Set(rendered.products.map(product=>product.id)).size;
          if(proof.allSlidesFit){proof.after=before;proof.restoredState=before;proof.restored=true;}
          else{
            const swipe=source.states.interaction.properties?.subject==='swipe'||!before.nextSelector||!before.previousSelector;
            const drag=async(reverse:boolean)=>{const state=await waitForNativeCatalogReady(widget),box=state.windowRect;if(!box||box.width<40||box.height<15)throw Error('Native target product carousel has no physical swipe window');const start=box.x+box.width*(reverse?.2:.75),end=box.x+box.width*(reverse?.75:.2),y=box.y+Math.min(box.height/2,120);await page.mouse.move(start,y);await page.mouse.down();await page.mouse.move(end,y,{steps:20});await page.mouse.up();};
            if(swipe){await drag(false);proof.dragged=true;}else{await widget.locator(before.nextSelector!).click({timeout:5000});proof.clicked=true;}
            proof.after=await waitForNativeCatalogReady(widget);const logical=(state:CatalogRuntimeState)=>JSON.stringify([state.activeIds,[...state.visibleIds].sort((a,b)=>a-b)]);proof.moved=logical(before)!==logical(proof.after);
            if(!proof.moved)throw Error('Actual native target-product next control or physical swipe did not change visible product identity');
            if(swipe)await drag(true);else await widget.locator(before.previousSelector!).click({timeout:5000});proof.restoredState=await waitForNativeCatalogReady(widget);proof.restored=logical(before)===logical(proof.restoredState);
            if(!proof.restored)throw Error('Native target-product previous control did not restore its original logical product identities');
          }
          rendered.carousel!.nextChanged=proof.moved;
        }
      }catch(error){proof.error=safeMessage(error);}
      if(source.states.interaction.status==='observed')receipt.observations.push({viewport,blockId:source.id,state:'interaction',status:proof.restored&&(proof.moved||proof.allSlidesFit)?'verified':'unverified',properties:{subject:proof.dragged?'swipe':proof.clicked?'arrow-next':source.states.interaction.properties?.subject==='swipe'?'swipe':'arrow-next',nextChangesSlide:proof.clicked&&proof.moved,swipeChangesSlide:proof.dragged&&proof.moved,arrows:!!proof.before?.nextSelector&&!!proof.before?.previousSelector,slideCount:receipt.catalogRenders?.find(render=>render.blockId===source.id)?.products.length??0,visibleSlides:proof.before?.visibleIds.length??0,allSlidesFit:proof.allSlidesFit,movementRequired:!proof.allSlidesFit},evidence:[path.join(directory,`${source.id}-states.json`)],note:proof.error});
    }
    const localCarousels = flattenNative([root]).filter(element => /carousel|slider|^slides$/.test(element.type));
    const carouselReceipts: FidelityPageStateReceipt['carousels'] = [];
    for (const native of localCarousels) {
      const targetId = compiled.elementMap[native.key], proof: FidelityPageStateReceipt['carousels'][number] = { blockId: source.id, key: native.key, targetId, clicked: false, moved: false, restored: false };
      receipt.carousels.push(proof); carouselReceipts.push(proof);
      try {
        const widget = page.locator(widgetSelector(targetId)).filter({ visible: true }).first();
        if(!await widget.count()){proof.inactiveAtViewport=true;continue;}
        await widget.scrollIntoViewIfNeeded({timeout:5_000});
        await widget.locator('.swiper-wrapper,.slick-track').first().waitFor({ state: 'attached', timeout: 12_000 });
        const initialReady=await waitForNativeCarouselReady(widget);await pauseCarouselByPointer(widget,initialReady.state);
        proof.before=(await waitForNativeCarouselReady(widget)).state;
        const next = widget.locator(nextSelector).filter({ visible: true }).first();
        const previous = widget.locator(previousSelector).filter({ visible: true }).first();
        if (proof.before.slideCount < 2) throw new Error('Native carousel has fewer than two original slides');
        proof.allSlidesFit = source.geometry[viewport]?.columns !== undefined && source.geometry[viewport].columns! >= proof.before.slideCount&&proof.before.visibilityVerified&&proof.before.visibleSlides===proof.before.slideCount;
        if (proof.allSlidesFit && (!await next.count() || !await previous.count())) { const actual=(await waitForNativeCarouselReady(widget)).state;proof.after=actual;proof.restoredState=actual;proof.restored=sameLogicalCarouselPosition(proof.before,actual);continue; }
        const useSwipe=source.states.interaction.properties?.subject==='swipe'||source.states.interaction.properties?.swipeChangesSlide!==undefined||!await next.count()||!await previous.count();
        const swipeWindow=widget.locator('.swiper,.swiper-container,.slick-list').filter({visible:true}).first();
        const drag=async(reverse:boolean)=>{
          const box=await swipeWindow.boundingBox();if(!box||box.width<40||box.height<15)throw new Error('Native carousel has no visible safe swipe window');
          const start=box.x+box.width*(reverse?0.2:0.75),end=box.x+box.width*(reverse?0.75:0.2),y=box.y+Math.min(box.height/2,120);
          await page.mouse.move(start,y);await page.mouse.down();await page.mouse.move(end,y,{steps:20});await page.mouse.up();
        };
        if(useSwipe){await drag(false);proof.dragged=true;}else{await next.click({ timeout: 5_000 }); proof.clicked = true;}
        await pauseCarouselByPointer(widget,proof.before);proof.after=(await waitForNativeCarouselReady(widget)).state;
        proof.moved = proof.before.activeIdentityVerified&&proof.after.activeIdentityVerified&&!sameLogicalCarouselPosition(proof.before,proof.after);
        if(useSwipe)proof.swipeChanged=proof.moved;
        if (!proof.moved) throw new Error('Actual native arrow or pointer swipe did not move the carousel');
        if(useSwipe)await drag(true);else await previous.click({ timeout: 5_000 });
        await pauseCarouselByPointer(widget,proof.before);proof.restoredState=(await waitForNativeCarouselReady(widget)).state;
        proof.restored=sameLogicalCarouselPosition(proof.before,proof.restoredState);
        if (!proof.restored) throw new Error('Native carousel active slide was not restored through its previous control');
      } catch (error) { if(error instanceof NativeCarouselReadinessError){proof.failureState=error.lastState;proof.readinessElapsedMs=error.elapsedMs;}proof.error = safeMessage(error); }
    }
    if (source.states.interaction.status === 'observed'&&!catalogBinding) {
      const activeReceipts=carouselReceipts.filter(item=>!item.inactiveAtViewport),first = activeReceipts[0]?.before;
      const properties: Record<string, string | number | boolean> = {
        subject:activeReceipts.length>0&&activeReceipts.every(item=>item.dragged)?'swipe':'arrow-next', nextChangesSlide: activeReceipts.length > 0 && activeReceipts.every(item => item.clicked&&item.moved), swipeChangesSlide:activeReceipts.length>0&&activeReceipts.every(item=>item.dragged&&item.swipeChanged), arrows: activeReceipts.length > 0 && activeReceipts.every(item => item.before?.next && item.before?.previous),
        carouselCount: activeReceipts.length, slideCount: first?.slideCount ?? 0, visibleSlides: first?.visibleSlides ?? 0, pagination: first?.pagination ?? false,
      };
      if (first?.autoplayDeclared !== undefined) properties.autoplayDeclared = first.autoplayDeclared;
      if (first?.autoplaySpeed !== undefined) properties.autoplaySpeed = first.autoplaySpeed;
      if (first?.loopDeclared !== undefined) properties.loopDeclared = first.loopDeclared;
      activeReceipts.forEach((item, carouselIndex) => { if (item.before) { properties[`carousel${carouselIndex}.slideCount`] = item.before.slideCount; properties[`carousel${carouselIndex}.visibleSlides`] = item.before.visibleSlides; properties[`carousel${carouselIndex}.nextChangesSlide`] = item.clicked&&item.moved;properties[`carousel${carouselIndex}.swipeChangesSlide`]=item.dragged===true&&item.swipeChanged===true; } });
      properties.allSlidesFit = activeReceipts.length > 0 && activeReceipts.every(item=>item.allSlidesFit);
      properties.movementRequired = !properties.allSlidesFit;
      receipt.observations.push({ viewport, blockId: source.id, state: 'interaction', status: activeReceipts.length > 0 && activeReceipts.every(item => (item.moved || item.allSlidesFit) && item.restored) ? 'verified' : 'unverified', properties, evidence: [path.join(directory, `${source.id}-states.json`)], note: activeReceipts.map(item => item.error).filter(Boolean).join('; ') || (properties.allSlidesFit ? 'All original source items fit at this proven viewport; next movement is not required here.' : undefined) });
    }
    if (source.states.hover.status === 'observed') {
      const proof: FidelityPageStateReceipt['hovers'][number] = { blockId: source.id, key: root.key, hovered: false, restored: false };
      receipt.hovers.push(proof);
      try {
        const hoverTextId=source.states.hover.properties?.sourceTextId;
        const dynamicHover=!!catalogBinding&&(typeof hoverTextId==='string'?catalogBinding.textIds.has(hoverTextId):/^product(?:-|\s)/.test(String(source.states.hover.properties?.subject??'')));
        let chosen:{key:string;suffix:string;subject:string},selected:Awaited<ReturnType<typeof selectPaintedHoverTarget>>;
        const scopeSelector=widgetSelector(compiled.elementMap[root.key]),scope=page.locator(scopeSelector).filter({visible:true}).first();
        if(!await scope.count())throw new Error('The exact source hover block is not rendered at this viewport');
        await scope.scrollIntoViewIfNeeded({timeout:5_000});await page.mouse.move(0,0);await page.waitForTimeout(100);
        if(dynamicHover){
          const rendered=receipt.catalogRenders?.find(item=>item.blockId===source.id),widgetSelectorValue=widgetSelector(compiled.elementMap[catalogBinding!.query.widgetKey]);
          if(!rendered?.products.length||!options.catalog?.evidence.length)throw Error('A native own-product hover requires actual target catalog and rendered product provenance');
          const candidates=page.locator(`${widgetSelectorValue} .product-grid-item.product[data-id] h1 a[href],${widgetSelectorValue} .product-grid-item.product[data-id] h2 a[href],${widgetSelectorValue} .product-grid-item.product[data-id] h3 a[href],${widgetSelectorValue} .product-grid-item.product[data-id] h4 a[href]`);
          selected=await selectPaintedHoverTarget(candidates);
          const actual=selected?await selected.locator.evaluate(element=>({id:Number(element.closest('.product-grid-item.product[data-id]')?.getAttribute('data-id')),name:element.textContent?.replace(/\s+/g,' ').trim()??'',href:(element as HTMLAnchorElement).href})):undefined;
          if(!selected||!actual||!rendered.products.some(product=>product.id===actual.id&&product.name===actual.name&&product.permalink===actual.href))throw Error('The physically painted product title does not match observed own catalog identity');
          chosen={key:catalogBinding!.query.widgetKey,suffix:'',subject:String(source.states.hover.properties?.subject??'product-link')};
        }else if(typeof source.states.hover.properties?.sourceHref==='string'&&typeof source.states.hover.properties?.sourceTextId!=='string'){
          const anchors=page.locator(`a${scopeSelector}[href],${scopeSelector} a[href]`);
          selected=await selectPaintedHoverTarget(anchors,{sourceHref:source.states.hover.properties.sourceHref});
          if(!selected?.targetId)throw new Error('The exact source hover URL has no unobstructed on-screen native anchor in this block');
          const mapping=Object.entries(compiled.elementMap).find(([,id])=>id===selected!.targetId),allowed=new Set(flattenNative([root]).map(node=>node.key));
          if(!mapping||!allowed.has(mapping[0]))throw new Error('The physically painted hover anchor is not owned by this native block');
          chosen={key:mapping[0],suffix:'',subject:String(source.states.hover.properties.subject??'link')};
        }else{
          chosen=chosenHoverNode(source,program,index);
          const ownerSelector=widgetSelector(compiled.elementMap[chosen.key]),owner=page.locator(ownerSelector);
          let candidates=chosen.suffix?page.locator(`${ownerSelector}:is(${chosen.suffix}),${ownerSelector} :is(${chosen.suffix})`):owner;
          if(chosen.suffix.includes('a,')&&await owner.locator('a').count())candidates=owner.locator('a');
          const sourceTextId=source.states.hover.properties?.sourceTextId,expectedText=typeof sourceTextId==='string'?source.texts.find(text=>text.id===sourceTextId)?.text.replace(/\s+/g,' ').trim():undefined;
          if(typeof sourceTextId==='string'&&!expectedText)throw new Error('The exact source hover text identity has no frozen source text');
          selected=await selectPaintedHoverTarget(candidates,{expectedText,sourceHref:typeof source.states.hover.properties?.sourceHref==='string'?source.states.hover.properties.sourceHref:undefined});
          if(!selected)throw new Error('The exact bound source hover leaf has no unobstructed on-screen native instance');
        }
        proof.key=chosen.key;const target=selected.locator;
        const{targetId,href,text,clone,point,rect,clip}=selected;proof.target={targetId,href,text,clone,point,rect,clip};proof.before = await waitForStableHoverPaint(target);
        await hoverPaintedTarget(selected);proof.hovered=await target.evaluate(element=>element.matches(':hover'));
        if(!proof.hovered)throw new Error('The actual physical pointer did not enter the exact source hover leaf');
        proof.after = await waitForStableHoverPaint(target);
        proof.screenshot = path.join(directory, `${source.id}-hover.png`); await page.screenshot({ path: proof.screenshot, fullPage: false });
        await page.mouse.move(0, 0);
        const restoredPaint = await waitForStableHoverPaint(target); proof.restored = JSON.stringify(restoredPaint) === JSON.stringify(proof.before);
        if (!proof.restored) throw new Error('Owned hover paint did not return to its normal state');
        const properties: Record<string, string | number | boolean> = { subject: chosen.subject, hovered: true, ...proof.after, 'background-color': proof.after.backgroundColor, 'border-color': proof.after.borderColor, 'box-shadow': proof.after.boxShadow, 'text-decoration-line': proof.after.textDecorationLine, underline: proof.after.textDecorationLine.includes('underline'), colorChanged: proof.before.color !== proof.after.color, backgroundChanged: proof.before.backgroundColor !== proof.after.backgroundColor, shadowChanged: proof.before.boxShadow !== proof.after.boxShadow, transformChanged: proof.before.transform !== proof.after.transform };
        if(!dynamicHover&&typeof source.states.hover.properties?.sourceTextId==='string')properties.sourceTextId=source.states.hover.properties.sourceTextId;
        if(dynamicHover)properties.targetProductId=await target.evaluate(element=>Number(element.closest('.product-grid-item.product[data-id]')?.getAttribute('data-id')));
        if(typeof source.states.hover.properties?.sourceHref==='string'){const actualHref=await target.getAttribute('href');if(actualHref)properties.sourceHref=new URL(actualHref,page.url()).href;}
        receipt.observations.push({ viewport, blockId: source.id, state: 'hover', status: 'verified', properties, evidence: [proof.screenshot, path.join(directory, `${source.id}-states.json`)] });
      } catch (error) { proof.error = safeMessage(error); receipt.observations.push({ viewport, blockId: source.id, state: 'hover', status: 'unverified', properties: {}, evidence: [path.join(directory, `${source.id}-states.json`)], note: proof.error }); }
    }
    if (source.states.normal.status === 'observed' && Object.keys(source.states.normal.properties ?? {}).length) {
      const properties = await page.locator(widgetSelector(compiled.elementMap[sourceProgram.rootKey])).first().evaluate(element => { const css = getComputedStyle(element), box = element.getBoundingClientRect(); return { color: css.color, background: css.backgroundColor, 'background-color': css.backgroundColor, width: box.width, height: box.height, display: css.display }; });
      receipt.observations.push({ viewport, blockId: source.id, state: 'normal', status: 'verified', properties, evidence: [path.join(directory, `${source.id}-states.json`)] });
    }
    await writeJson(path.join(directory, `${source.id}-states.json`), { blockId: source.id, viewport, carousels: carouselReceipts,catalogRenders:receipt.catalogRenders?.filter(item=>item.blockId===source.id),catalogInteractions:receipt.catalogInteractions?.filter(item=>item.blockId===source.id), hovers: receipt.hovers.filter(item => item.blockId === source.id), observations: receipt.observations.filter(item => item.blockId === source.id) });
  }
  await page.evaluate(() => scrollTo(0, 0));
  receipt.aliases=await page.evaluate(mappings=>mappings.map(({elementKey,targetId})=>{
    const elements=Array.from(document.querySelectorAll(`[data-id="${targetId}"]`)),cloneKinds=new Set<string>();let cloneCount=0;
    for(const element of elements){const clone=element.closest('.slick-cloned,.swiper-slide-duplicate,.elementor-sticky__spacer');if(clone){cloneCount++;for(const name of ['slick-cloned','swiper-slide-duplicate','elementor-sticky__spacer'])if(clone.classList.contains(name))cloneKinds.add(name);}}
    return{elementKey,targetId,rawCount:elements.length,logicalCount:elements.length-cloneCount,cloneCount,cloneKinds:[...cloneKinds]};
  }).filter(item=>item.rawCount>1),Object.entries(compiled.elementMap).map(([elementKey,targetId])=>({elementKey,targetId})));
  receipt.unrequestedLazyRows=await page.evaluate(ids=>Array.from(document.querySelectorAll<HTMLImageElement>('.elementor img')).filter(image=>{
    const owner=image.closest('[data-id]')?.getAttribute('data-id');return !!owner&&ids.includes(owner)&&image.loading==='lazy'&&!image.currentSrc&&image.naturalWidth===0&&!image.hasAttribute('data-src')&&!image.hasAttribute('data-lazy-src');
  }).map(image=>{
    const box=image.getBoundingClientRect(),window=image.closest('.swiper,.swiper-container,.slick-list')?.getBoundingClientRect();
    return{url:image.currentSrc||image.src,src:image.src,currentSrc:image.currentSrc,loading:image.loading,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,complete:image.complete,rect:{x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height},outsideViewportHorizontal:box.right<=0||box.left>=innerWidth,outsideCarouselHorizontal:!!window&&(box.right<=window.left||box.left>=window.right),clone:!!image.closest('.slick-cloned,.swiper-slide-duplicate')};
  }).filter(image=>image.outsideViewportHorizontal||image.outsideCarouselHorizontal),Object.values(compiled.elementMap));
  const blockOwners=new Map<string,string>();program.elements.forEach((node,index)=>flattenNative([node]).forEach(child=>blockOwners.set(child.key,contract.blocks[index].id)));
  receipt.horizontalScrollClips=await page.evaluate(mappings=>{
    const rows:Array<{elementKey:string;targetId:string;ancestorId:string;ancestorSelector:string;overflowX:string;ancestorRect:{x:number;y:number;width:number;height:number};childRect:{x:number;y:number;width:number;height:number};scrollWidth:number;clientWidth:number;documentWidth:number;viewportWidth:number;blockId:string}>=[];
    const documentWidth=document.documentElement.scrollWidth,viewportWidth=innerWidth,known=new Set(mappings.map(mapping=>mapping.targetId));
    if(documentWidth>viewportWidth+4)return rows;
    for(const mapping of mappings)for(const element of document.querySelectorAll(`[data-id="${mapping.targetId}"]`)){
      if(element.closest('.slick-cloned,.swiper-slide-duplicate,.elementor-sticky__spacer'))continue;
      const child=element.getBoundingClientRect();if(child.width<=0||child.height<=0||child.left>=-4&&child.right<=viewportWidth+4)continue;
      for(let ancestor=element.parentElement;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement){
        const css=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect(),owner=ancestor.matches('[data-id]')?ancestor:ancestor.closest('[data-id]'),id=owner?.getAttribute('data-id');
        if(!['auto','scroll'].includes(css.overflowX)||!id||!known.has(id)||box.width<=0||box.left< -4||box.right>viewportWidth+4||ancestor.scrollWidth<=ancestor.clientWidth+4)continue;
        rows.push({...mapping,ancestorId:id,ancestorSelector:`[data-id="${id}"]`,overflowX:css.overflowX,ancestorRect:{x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height},childRect:{x:child.x+scrollX,y:child.y+scrollY,width:child.width,height:child.height},scrollWidth:ancestor.scrollWidth,clientWidth:ancestor.clientWidth,documentWidth,viewportWidth});break;
      }
    }
    return rows;
  },Object.entries(compiled.elementMap).map(([elementKey,targetId])=>({elementKey,targetId,blockId:blockOwners.get(elementKey)!})));
  await writeJson(path.join(directory, 'receipt.json'), receipt);
  return receipt;
}

/** Geometry and normal-motion interaction proofs share one navigation per viewport. */
export async function captureFidelityViewports(options:{
  program:NativeProgram;contract:BlockContract;compiled:CompiledFidelity;previewUrl:string;runDir:string;
  cookies:Cookie[];viewports:Viewport[];browser:Browser;catalog?:TargetCatalogEvidence;assets?:FidelityImportedAsset[];
  bindings:Array<ElementBinding&{sourceId:string}>;nativeCatalogIds:string[];concurrency?:1|2;nativeDocumentId?:number;
}){
  const receipts=new Map<string,FidelityPageStateReceipt>();
  const presentation=new Map<string,TargetPresentationEvidence[]>();
  const measurements=await captureTarget({previewUrl:options.previewUrl,runDir:options.runDir,viewports:options.viewports,elementMap:options.bindings,auth:{cookies:options.cookies},browser:options.browser,nativeRootIds:options.compiled.sectionIds,nativeCatalogIds:options.nativeCatalogIds,nativeDocumentId:options.nativeDocumentId,concurrency:options.concurrency??2,
    inspectPage:async(page,viewport)=>{
      const evidencePath=path.join(options.runDir,'verification/presentation',`${viewport.name}.json`),rows=await collectTargetPresentationEvidence({...options,page,viewport:viewport.name,evidencePath});
      presentation.set(viewport.name,rows);await writeJson(evidencePath,rows);
      receipts.set(viewport.name,await inspectFidelityPage({...options,page,viewport:viewport.name}));
    },
  });
  return{measurements,presentationEvidence:options.viewports.flatMap(view=>presentation.get(view.name)??[]),stateReceipts:options.viewports.map(view=>{const receipt=receipts.get(view.name);if(!receipt)throw Error('Shared viewport capture omitted an actual interaction receipt');return receipt;}),navigationCount:options.viewports.length};
}
export function normalizeFidelityMeasurements(measurements: TargetViewportEvidence[], program: NativeProgram, compiled: CompiledFidelity,stateReceipts:FidelityPageStateReceipt[]=[]) {
  const descendants = new Set<string>();
  const nativeCatalogIDs=new Set((program.blocks??[]).flatMap((block,index)=>{const query=block.productQuery;if(query?.provider!=='target-woocommerce'||query.widgetType!=='wd_products'||!query.carouselMode||block.rootKey!==program.elements[index]?.key)return[];const nodes=flattenNative([program.elements[index]]).filter(node=>node.key===query.widgetKey&&node.type==='wd_products'&&!node.children?.length&&node.settings[query.carouselMode!.control]===query.carouselMode!.value);return nodes.length===1?[compiled.elementMap[query.widgetKey]]:[];}));
  const nativeCarouselIDs=new Set(flattenNative(program.elements).filter(node=>/carousel|slider|^slides$/.test(node.type)).map(node=>compiled.elementMap[node.key]));
  for(const id of nativeCatalogIDs)nativeCarouselIDs.add(id);
  const nativeContainerIDs=new Set(flattenNative(program.elements).filter(node=>node.type==='container').map(node=>compiled.elementMap[node.key]));
  for (const node of flattenNative(program.elements)) if (/carousel|slider|^slides$/.test(node.type)) for (const child of flattenNative(node.children ?? [])) descendants.add(compiled.elementMap[child.key]);
  return measurements.map(view => {
    const receipt=stateReceipts.find(receipt=>receipt.viewport===view.name),carouselKeys=flattenNative(program.elements).filter(node=>/carousel|slider|^slides$/.test(node.type)).map(node=>node.key),carouselWindows=view.elements.filter(element=>carouselKeys.includes(element.sourceId)&&element.found).map(element=>element.rect);
    const roots=new Set(program.elements.map(node=>node.key)),images=view.elements.filter(element=>roots.has(element.sourceId)).flatMap(element=>element.images);
    const outside=(image:typeof images[number])=>image.rect.x+image.rect.width<=0||image.rect.x>=view.width||carouselWindows.some(window=>image.rect.y+image.rect.height>window.y&&image.rect.y<window.y+window.height&&(image.rect.x+image.rect.width<=window.x||image.rect.x>=window.x+window.width));
    const provenURLs=new Set((receipt?.unrequestedLazyRows??[]).filter(row=>row.loading==='lazy'&&!row.currentSrc&&row.naturalWidth===0&&(row.outsideViewportHorizontal||row.outsideCarouselHorizontal)).map(row=>row.url));
    const imageFailures=view.imageFailures.filter(failure=>{
      if(!provenURLs.has(failure.url))return true;
      const failedOccurrences=images.filter(image=>image.url===failure.url&&image.naturalWidth===0);
      // A visible original with the same URI blocks exclusion of its offscreen clone; below-fold alone is never enough proof.
      return !failedOccurrences.length||failedOccurrences.some(image=>!outside(image));
    });
    return{...view,imageFailures,elements:view.elements.map(element=>{const alias=receipt?.aliases?.find(alias=>alias.elementKey===element.sourceId);return alias&&alias.rawCount===element.count&&alias.logicalCount===1&&alias.cloneCount>0?{...element,count:1}:element;}),overflow:view.overflow.filter(item=>{
      const proof=(view as TargetViewportEvidence&{nativeCarouselClips?:NativeCarouselClipEvidence[]}).nativeCarouselClips?.find(proof=>proof.selector===item.selector&&(['x','y','width','height']as const).every(dimension=>Math.abs(proof.childRect[dimension]-item.rect[dimension])<.01));
      if(proof&&nativeCarouselIDs.has(proof.carouselId)&&(/carousel|slider|^slides$/.test(proof.widgetType.split('.')[0])||proof.widgetType.split('.')[0]==='wd_products'&&nativeCatalogIDs.has(proof.carouselId))&&['hidden','clip'].includes(proof.overflowX)&&proof.documentWidth<=proof.viewportWidth+4&&proof.viewportWidth===view.width&&proof.windowRect.width>0&&proof.windowRect.height>0&&proof.windowRect.x>=-4&&proof.windowRect.x+proof.windowRect.width<=view.width+4&&proof.childDomPath.startsWith(`${proof.windowDomPath} > `))return false;
      const nativeScroll=(view as TargetViewportEvidence&{nativeScrollClips?:NativeScrollClipEvidence[]}).nativeScrollClips?.find(proof=>proof.selector===item.selector&&(['x','y','width','height']as const).every(dimension=>Math.abs(proof.childRect[dimension]-item.rect[dimension])<.01));
      if(nativeScroll&&nativeContainerIDs.has(nativeScroll.ancestorId)&&nativeScroll.ancestorType==='container'&&['auto','scroll'].includes(nativeScroll.overflowX)&&nativeScroll.scrollWidth>nativeScroll.clientWidth+4&&nativeScroll.documentWidth<=nativeScroll.viewportWidth+4&&nativeScroll.viewportWidth===view.width&&nativeScroll.windowRect.width>0&&nativeScroll.windowRect.height>0&&nativeScroll.windowRect.x>=-4&&nativeScroll.windowRect.x+nativeScroll.windowRect.width<=view.width+4&&nativeScroll.childDomPath.startsWith(`${nativeScroll.windowDomPath} > `))return false;
      const id=/\[data-id="([a-f\d]+)"\]/.exec(item.selector)?.[1];
      const clip=receipt?.horizontalScrollClips?.find(clip=>clip.targetId===id);
      if(!clip)return true;
      return !(['auto','scroll'].includes(clip.overflowX)&&clip.documentWidth<=clip.viewportWidth+4&&clip.ancestorRect.x>=-4&&clip.ancestorRect.x+clip.ancestorRect.width<=clip.viewportWidth+4&&clip.scrollWidth>clip.clientWidth+4);
    })};
  });
}
/** Responsive alternatives may use one canonical owner only after actual clone receipts prove it. */
export function resolveProvenResponsiveTextMeasurements(measurements:TargetViewportEvidence[],program:NativeProgram,compiled:CompiledFidelity,stateReceipts:FidelityPageStateReceipt[],alternatives:ResponsiveTextBinding[],packets:SourceTextPaintPacket[],contract:BlockContract){
  return resolveResponsiveTextMeasurements(normalizeFidelityMeasurements(measurements,program,compiled,stateReceipts),alternatives,packets,contract);
}
export function bindSourceScrollEvidence(receipts:FidelityPageStateReceipt[],packets:SourceTextPaintPacket[]):void{
  for(const receipt of receipts)for(const clip of receipt.horizontalScrollClips??[]){
    const evidence=packets.filter(packet=>packet.viewport===receipt.viewport).flatMap(packet=>{
      const block=packet.blocks.find(block=>block.id===clip.blockId);if(!block)return[];
      const styles=[block.style,...(block.rootStyles??[]).map(root=>root.style)].filter((style):style is Record<string,unknown>=>!!style&&typeof style==='object');
      return styles.some(style=>['auto','scroll'].includes(String(style['overflow-x'])))?[packet.evidencePath]:[];
    });
    clip.sourceStatus=evidence.length?'observed':'unverified';clip.sourceEvidence=[...new Set(evidence)];
    if(!evidence.length)clip.sourceGap='Target native horizontal scrolling is observed, but this frozen source block has no matching full ancestor overflow-x:auto/scroll evidence; source equivalence remains unverified';else delete clip.sourceGap;
  }
}
function addScrollEvidenceGaps(report:ReturnType<typeof verifyFidelity>,receipts:FidelityPageStateReceipt[]):void{
  const seen=new Set<string>();
  for(const receipt of receipts)for(const clip of receipt.horizontalScrollClips??[]){if(clip.sourceStatus!=='unverified')continue;const identity=`${receipt.viewport}:${clip.blockId}`;if(seen.has(identity))continue;seen.add(identity);report.passed=false;if(report.structurePassed)report.status='needs-review';report.issues.push({code:'source-horizontal-scroll-unverified',severity:'warning',viewport:receipt.viewport,blockId:clip.blockId,message:clip.sourceGap!});}
}
/** Full native acceptance on one owned draft: readback → real frontend → each editor section → actual UI changes → guarded restore → final readback. */
export async function checkFidelityDraft(options: {
  program: NativeProgram; contract: BlockContract; compiled: CompiledFidelity; client: WordPressClient; snapshot: DraftSnapshot;
  schemas: Record<string, LegacySchema>; assets: FidelityImportedAsset[]; editUrl: string; previewUrl: string; cookies: Cookie[]; runDir: string;
  onProgress?: (message: string) => void | Promise<void>; onSnapshot?: (snapshot: DraftSnapshot) => void;
  catalog?:TargetCatalogEvidence;
  /** Only a hash-bound same-run style revision may reuse actual prior editor UI proof. */
  editorCheckpoint?: ReusableEditorCheckpoint;
}) {
  return withTaskEditorWorkflow({ runDir: options.runDir, snapshot: options.snapshot, editorUrl: options.editUrl, verifyOwnership: async () => { assertDraftHash((await options.client.snapshotDraft(options.snapshot.pageId)).hash, options.snapshot.hash); return true; } }, async () => {
  const { program, contract, compiled, client, snapshot, schemas, assets, editUrl, previewUrl, cookies, runDir } = options;
  const catalogBindings=validateTargetCatalogBindings(contract,program),catalogWidgetKeys=new Set([...catalogBindings.values()].map(binding=>binding.query.widgetKey)),nativeCatalogIds=[...catalogWidgetKeys].map(key=>compiled.elementMap[key]);
  const bindings = flattenNative(program.elements).map(node => ({ sourceId: node.key, targetId: compiled.elementMap[node.key], kind: catalogWidgetKeys.has(node.key)?'container':kind(node.type), selector:nativeBoundTitleSelector(program,compiled,schemas,node) }));
  const responsiveBindings=responsiveTextBindings(contract,program,compiled,schemas);
  const responsiveCaptureBindings:Array<ElementBinding&{sourceId:string}>=responsiveBindings.filter(binding=>binding.selector).map(binding=>({sourceId:binding.measurementKey,targetId:compiled.elementMap[binding.nativeKey],selector:binding.selector,kind:'text'}));
  const sourceJobDir=path.isAbsolute(program.sourceContract.path)?path.dirname(program.sourceContract.path):path.dirname(path.dirname(contract.referenceReport.path));
  const textPaintPackets=await loadSourceTextPaint(contract,sourceJobDir);
  const viewportPlan=await loadSourceViewportPlan(contract,sourceJobDir),viewports=viewportPlan.viewports,sourceCoverage=await loadSourceCoverage(contract,sourceJobDir,{program}),runtime=createRuntimeTrace();runtime.phase('browser-launch');
  const browserPlan=sourceBrowserLaunchPlan(viewports);
  await writeJson(path.join(runDir,'verification/browser-environment-plan.json'),browserPlan);
  const browser = await chromium.launch(browserPlan.options);
  const finalPresentation=new Map<string,TargetPresentationEvidence[]>();
  const capture = (directory: string) => captureTarget({ previewUrl, runDir: directory, viewports, elementMap: [...bindings,...responsiveCaptureBindings], auth: { cookies }, browser,nativeRootIds:compiled.sectionIds,nativeCatalogIds,nativeDocumentId:snapshot.pageId,concurrency:2,inspectPage:async(page,viewport)=>{const evidencePath=path.join(directory,'verification/presentation',`${viewport.name}.json`),rows=await collectTargetPresentationEvidence({program,contract,compiled,page,viewport:viewport.name,evidencePath,assets});finalPresentation.set(viewport.name,rows);await writeJson(evidencePath,rows);} });
  try {
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
    const savedNodes:DraftSnapshot['elements']=[];const collectSaved=(nodes:DraftSnapshot['elements'])=>{for(const node of nodes){savedNodes.push(node);collectSaved(node.elements??[]);}};collectSaved(snapshot.elements);
    const savedOwners=new Map<string,number>();for(const node of savedNodes)savedOwners.set(node.id,(savedOwners.get(node.id)??0)+1);
    if(canonical(snapshot.elements.map(node=>node.id))!==canonical(compiled.sectionIds)||[...savedOwners.values()].some(count=>count!==1)||bindings.some(binding=>savedOwners.get(binding.targetId)!==1))throw new Error('Actual native readback must contain one canonical owner for every mapped source element and preserve source root order');
    const nativeDocument={passed:true,readbackHash:snapshot.hash,rootOrder:snapshot.elements.map(node=>node.id),uniqueOwners:savedOwners.size,mappedOwners:bindings.length,duplicateNativeIDs:[]};
    await options.onProgress?.('fidelity-frontend-source-block-comparison');
    runtime.phase('shared-viewport-geometry-and-states');
    const initialCapture=await captureFidelityViewports({program,contract,compiled,previewUrl,runDir,cookies,viewports,browser,catalog:options.catalog,assets,bindings:[...bindings,...responsiveCaptureBindings],nativeCatalogIds,nativeDocumentId:snapshot.pageId});
    const initialMeasurements = initialCapture.measurements;
    const stateReceipts = initialCapture.stateReceipts;
    const catalogRenders=stateReceipts.flatMap(receipt=>receipt.catalogRenders??[]);
    await writeJson(path.join(runDir,'verification/target-catalog-render.json'),{catalog:options.catalog??null,renders:catalogRenders});
    const catalogRolePaint=compareCatalogRolePaint(contract,program,textPaintPackets,catalogRenders);
    await writeJson(path.join(runDir,'verification/catalog-role-paint.json'),catalogRolePaint);
    const initialResponsive=resolveProvenResponsiveTextMeasurements(initialMeasurements,program,compiled,stateReceipts,responsiveBindings,textPaintPackets,contract);
    const initialTextPaint=compareBoundTextPaint(contract,program,initialResponsive.measurements,textPaintPackets);
    await writeJson(path.join(runDir,'verification/text-paint-initial.json'),initialTextPaint);
    bindSourceScrollEvidence(stateReceipts,textPaintPackets);
    await writeJson(path.join(runDir,'verification/native-scroll-clipping.json'),stateReceipts.map(receipt=>({viewport:receipt.viewport,documentWidth:receipt.documentWidth,viewportWidth:receipt.viewportWidth,horizontalScrollClips:receipt.horizontalScrollClips??[]})));
    const observations = stateReceipts.flatMap(receipt => receipt.observations);
    const initialNormalized=normalizeFidelityMeasurements(initialResponsive.measurements, program, compiled,stateReceipts);
    const initial = verifyFidelity(contract, program, initialNormalized, observations,catalogRenders,initialCapture.presentationEvidence,textPaintPackets);
    for(const issue of catalogRolePaint.issues){initial.issues.push(issue);initial.passed=false;if(issue.severity==='error'){initial.structurePassed=false;initial.status='failed';}else if(initial.status==='passed')initial.status='needs-review';}
    const initialBackgroundMedia=verifyNativeBackgroundMedia(program,compiled,schemas,assets,initialNormalized);
    addScrollEvidenceGaps(initial,stateReceipts);
    for (const receipt of stateReceipts) if (receipt.documentWidth > receipt.viewportWidth + 4) { initial.passed = false; initial.structurePassed = false; initial.status = 'failed'; initial.issues.push({ code: 'document-overflow', severity: 'error', viewport: receipt.viewport, message: 'Actual document exceeds viewport width beyond pixel tolerance', expected: receipt.viewportWidth, actual: receipt.documentWidth }); }
    await writeJson(path.join(runDir, 'verification/browser-initial.json'), { ...initial, rawMeasurements: initialMeasurements, stateReceipts,textPaint:initialTextPaint });
    let editorSections: Awaited<ReturnType<typeof verifyOriginalEditorSections>>;
    let editability: Awaited<ReturnType<typeof verifyNativeEditor>>;
    let carouselEditor: Awaited<ReturnType<typeof verifyFidelityCarouselEditor>>;
    let catalogQueryEditor: Awaited<ReturnType<typeof verifyCatalogQueryEditor>>;
    const checkpoint = options.editorCheckpoint;
    if (checkpoint) {
      if (checkpoint.reuse.targetDocumentHash !== snapshot.hash || checkpoint.reuse.pageId !== snapshot.pageId || checkpoint.reuse.runId !== snapshot.runId || canonical(checkpoint.editorSections.sections.map(section => section.targetId)) !== canonical(compiled.sectionIds)) throw new Error('Editor checkpoint does not belong to the actual current native document');
      ({ editorSections, editability, carouselEditor, catalogQueryEditor } = checkpoint);
      await writeJson(path.join(runDir, 'verification/editor-proof-reuse.json'), checkpoint.reuse);
      await options.onProgress?.('reuse-hash-bound-actual-editor-proof-for-style-only-revision');
      runtime.phase('reuse-prior-actual-editor-proof');
    } else {
    await options.onProgress?.('all-native-source-block-editor-selection');
    runtime.phase('native-editor-selection');
    const proxy: OriginalDesign = { version: 1, brand: 'Source block verification', title: program.title, language: 'en', description: 'Native source block editor verification proxy', tokens: { colors: {}, font: 'Arial', contentWidth: 1200 }, assets: [], sections: program.elements.map((node): OriginalNode => ({ key: node.key, kind: 'container' })) };
    editorSections = await verifyOriginalEditorSections({ design: proxy, elementMap: compiled.elementMap, editorUrl: editUrl, runDir, auth: { cookies }, browser });
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
    const replacementPath = path.join(runDir, 'assets/editor-check.png'), replacementBytes = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#a319cc' } }).png().toBuffer();
    await writeJson(path.join(runDir, 'assets/editor-check-provenance.json'), { purpose: 'Temporary owned native editor image check, never a source replacement' }); await writeFile(replacementPath, replacementBytes);
    const replacement = await client.importAsset(replacementPath, { runId: snapshot.runId, pageId: snapshot.pageId, sourceUrl: `data:image/png;base64,${replacementBytes.toString('base64')}`, mimeType: 'image/png', alt: 'Temporary owned native editor verification' });
    await options.onProgress?.('native-content-image-style-save-and-guarded-restore');
    runtime.phase('native-content-save-and-restore');
    editability = await verifyNativeEditor({
      editorUrl: editUrl, previewUrl, pageId: snapshot.pageId, runDir, cookies, widgetMap: bindings, browser,
      imageReplacement: { attachmentId: replacement.attachmentId, url: replacement.url }, requiredFields: ['title','style','image'],
      restore: async edits => { await writeJson(path.join(runDir, 'verification/editor/authorized-edits.json'), edits); const modified = await client.snapshotDraft(snapshot.pageId); assertAuthorizedEditorChanges(snapshot, modified, edits, schemas); const restored = await client.restoreDraft(snapshot.pageId, snapshot, { expectedCurrent: modified }); options.onSnapshot?.(restored); return restored.hash === snapshot.hash; },
    });
    await writeJson(path.join(runDir, 'verification/editability.json'), editability);
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
    await options.onProgress?.('native-carousel-panel-display-save-and-guarded-restore');
    runtime.phase('native-carousel-save-and-restore');
    carouselEditor=await verifyFidelityCarouselEditor({program,compiled,client,snapshot,schemas,editorUrl:editUrl,previewUrl,cookies,runDir,browser,onSnapshot:options.onSnapshot});
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash,snapshot.hash);
    await options.onProgress?.('native-own-product-query-save-frontend-and-guarded-restore');
    runtime.phase('native-catalog-save-and-restore');
    catalogQueryEditor=await verifyCatalogQueryEditor({program,contract,compiled,client,snapshot,schemas,editorUrl:editUrl,previewUrl,cookies,catalog:options.catalog,runDir,browser,onSnapshot:options.onSnapshot});
    assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash,snapshot.hash);
    }
    await options.onProgress?.('final-fidelity-frontend-and-document-hash');
    runtime.phase('final-frontend-capture');
    const finalMeasurements = await capture(path.join(runDir, 'final')),finalResponsive=resolveProvenResponsiveTextMeasurements(finalMeasurements,program,compiled,stateReceipts,responsiveBindings,textPaintPackets,contract),finalNormalized=normalizeFidelityMeasurements(finalResponsive.measurements, program, compiled,stateReceipts), final = verifyFidelity(contract, program, finalNormalized, observations,catalogRenders,viewports.flatMap(view=>finalPresentation.get(view.name)??[]),textPaintPackets);
    for(const issue of catalogRolePaint.issues){final.issues.push(issue);final.passed=false;if(issue.severity==='error'){final.structurePassed=false;final.status='failed';}else if(final.status==='passed')final.status='needs-review';}
    addScrollEvidenceGaps(final,stateReceipts);
    const textPaint=compareBoundTextPaint(contract,program,finalResponsive.measurements,textPaintPackets);await writeJson(path.join(runDir,'verification/text-paint-final.json'),textPaint);
    await writeJson(path.join(runDir,'verification/responsive-text-bindings.json'),{version:1,planned:responsiveBindings,initial:initialResponsive.receipts,final:finalResponsive.receipts});
    const backgroundMedia=verifyNativeBackgroundMedia(program,compiled,schemas,assets,finalNormalized);await writeJson(path.join(runDir,'verification/native-background-media.json'),{version:1,initial:initialBackgroundMedia,final:backgroundMedia});
    runtime.phase('local-region-pixel-comparison');
    const visual=await verifyVisualAcceptance({contract,program,sourceViewports:viewportPlan.viewports,measurements:finalNormalized,presentationEvidence:viewports.flatMap(view=>finalPresentation.get(view.name)??[]),sourcePackets:textPaintPackets,sourceJobDir,runDir,planGaps:viewportPlan.gaps,catalogRenders,catalogRolePaint});
    const readback = await client.snapshotDraft(snapshot.pageId); assertDraftHash(readback.hash, snapshot.hash);
    const completion=fidelityCompletion({
      editable:verdict(editorSections.passed&&editability.status==='verified'&&carouselEditor.passed&&catalogQueryEditor.passed,editability.status==='failed'||!editorSections.passed),
      data:verdict(nativeDocument.passed&&(final.productChecks??[]).every(check=>check.status==='verified'),(final.productChecks??[]).some(check=>check.status==='failed')),
      visual:verdict(visual.passed&&textPaint.passed&&initialTextPaint.passed&&backgroundMedia.passed&&initialBackgroundMedia.passed&&final.presentationDetails.passed&&catalogRolePaint.passed,visual.status==='failed'||textPaint.status==='failed'||initialTextPaint.status==='failed'||catalogRolePaint.status==='failed'||final.presentationDetails.status==='failed'||!backgroundMedia.passed||!initialBackgroundMedia.passed),
      behavior:verdict(initial.statesVerified&&final.statesVerified,[...initial.issues,...final.issues].some(issue=>issue.severity==='error'&&/state|interaction|hover|carousel/.test(issue.code))),
      responsive:verdict(viewports.every(view=>finalNormalized.some(actual=>actual.name===view.name&&actual.width===view.width))&&final.coverage.every(view=>view.expectedBlocks===view.matchedBlocks)&&!final.issues.some(issue=>/overflow|geometry|content-bounds|viewport/.test(issue.code)),final.issues.some(issue=>issue.severity==='error'&&/overflow|geometry|content-bounds|viewport/.test(issue.code))),
      evidence:verdict(sourceCoverage.passed&&viewportPlan.gaps.length===0&&visual.issues.every(issue=>issue.severity!=='warning'),sourceCoverage.status==='failed'),
      issues:[...initial.issues,...final.issues,...visual.issues,...sourceCoverage.issues],limitations:final.limitations,
    });
    const passed=completion.passed;runtime.finish();
    const verificationPath = path.join(runDir, 'verification/final.json'), report = { version: 1, workflow: 'block-replication', passed,status:completion.status,completion,visual,sourceCoverage,viewportPlan,runtime:runtime.snapshot(),fidelity: final, initialFidelity: initial,presentationDetails:final.presentationDetails,presentationEvidence:viewports.flatMap(view=>finalPresentation.get(view.name)??[]),textPaint,initialTextPaint,backgroundMedia,initialBackgroundMedia,responsiveTextBindings:finalResponsive.receipts,nativeDocument,measurements: finalMeasurements, stateReceipts,catalogRenders,catalogRolePaint, editorSections, editability, carouselEditor,catalogQueryEditor, ...(checkpoint ? { editorProofReuse: checkpoint.reuse } : {}), restoredHash: readback.hash, blocksBuilt: contract.blocks.length, nativeElements: flattenNative(program.elements).length, limitations: final.limitations };
    await writeJson(verificationPath, report); return { passed, verificationPath, snapshot: readback, report };
  } finally { await browser.close(); }
  });
}

/** Revalidate the exact owned document with fresh browser evidence; this function has no target writer or editor entry point. */
export async function checkFidelityFrontend(options:{
  program:NativeProgram;contract:BlockContract;compiled:CompiledFidelity;client:Pick<WordPressClient,'snapshotDraft'>;snapshot:DraftSnapshot;
  schemas:Record<string,LegacySchema>;assets:FidelityImportedAsset[];catalog?:TargetCatalogEvidence;previewUrl:string;cookies:Cookie[];runDir:string;
  onProgress?:(message:string)=>void|Promise<void>;
}){
  const{program,contract,compiled,client,snapshot,schemas,assets,catalog,previewUrl,cookies,runDir}=options;
  const preview=new URL(previewUrl),previewIds=['page_id','p','preview_id'].map(key=>preview.searchParams.get(key)).filter((id):id is string=>id!==null);
  if(snapshot.status!=='draft'||!['http:','https:'].includes(preview.protocol)||preview.username||preview.password||previewIds.some(id=>id!==String(snapshot.pageId))||catalog&&catalog.targetOrigin!==preview.origin)throw Error('Read-only frontend verification requires the exact owned draft and credential-free target preview origin');
  const catalogBindings=validateTargetCatalogBindings(contract,program),catalogWidgetKeys=new Set([...catalogBindings.values()].map(binding=>binding.query.widgetKey)),nativeCatalogIds=[...catalogWidgetKeys].map(key=>compiled.elementMap[key]);
  const bindings=flattenNative(program.elements).map(node=>({sourceId:node.key,targetId:compiled.elementMap[node.key],kind:catalogWidgetKeys.has(node.key)?'container':kind(node.type),selector:nativeBoundTitleSelector(program,compiled,schemas,node)}));
  const responsiveBindings=responsiveTextBindings(contract,program,compiled,schemas),responsiveCaptureBindings:Array<ElementBinding&{sourceId:string}>=responsiveBindings.filter(binding=>binding.selector).map(binding=>({sourceId:binding.measurementKey,targetId:compiled.elementMap[binding.nativeKey],selector:binding.selector,kind:'text'}));
  const sourceJobDir=path.isAbsolute(program.sourceContract.path)?path.dirname(program.sourceContract.path):path.dirname(path.dirname(contract.referenceReport.path)),textPaintPackets=await loadSourceTextPaint(contract,sourceJobDir),viewportPlan=await loadSourceViewportPlan(contract,sourceJobDir),viewports=viewportPlan.viewports,sourceCoverage=await loadSourceCoverage(contract,sourceJobDir,{program});
  const nodes:DraftSnapshot['elements']=[];const collect=(elements:DraftSnapshot['elements'])=>{for(const node of elements){nodes.push(node);collect(node.elements??[]);}};collect(snapshot.elements);const owners=new Map<string,number>();for(const node of nodes)owners.set(node.id,(owners.get(node.id)??0)+1);
  if(canonical(snapshot.elements.map(node=>node.id))!==canonical(compiled.sectionIds)||[...owners.values()].some(count=>count!==1)||bindings.some(binding=>owners.get(binding.targetId)!==1))throw Error('Read-only native document must preserve its complete canonical root order and unique mapped owners');
  const requireSame=(actual:DraftSnapshot)=>{assertDraftHash(actual.hash,snapshot.hash);if(actual.pageId!==snapshot.pageId||actual.runId!==snapshot.runId||actual.status!==snapshot.status||actual.title!==snapshot.title||canonical(actual.elements)!==canonical(snapshot.elements)||canonical(actual.settings)!==canonical(snapshot.settings))throw Error('Owned draft changed during read-only frontend verification; preserve the concurrent change');};
  const before=await client.snapshotDraft(snapshot.pageId);requireSame(before);
  const nativeDocument={passed:true,readbackHash:before.hash,rootOrder:before.elements.map(node=>node.id),uniqueOwners:owners.size,mappedOwners:bindings.length,duplicateNativeIDs:[]};
  const runtime=createRuntimeTrace();runtime.phase('browser-launch');
  const browserPlan=sourceBrowserLaunchPlan(viewports);
  await writeJson(path.join(runDir,'verification/browser-environment-plan.json'),browserPlan);
  const browser=await chromium.launch(browserPlan.options);
  try{
    await options.onProgress?.('fresh-read-only-source-viewports-and-native-catalog');
    runtime.phase('shared-viewport-geometry-and-states');
    const captured=await captureFidelityViewports({program,contract,compiled,previewUrl,runDir,cookies,viewports,browser,catalog,assets,bindings:[...bindings,...responsiveCaptureBindings],nativeCatalogIds,nativeDocumentId:snapshot.pageId});
    const rawMeasurements=captured.measurements,stateReceipts=captured.stateReceipts,catalogRenders=stateReceipts.flatMap(receipt=>receipt.catalogRenders??[]);
    runtime.phase('source-comparison-and-readback');
    const responsive=resolveProvenResponsiveTextMeasurements(rawMeasurements,program,compiled,stateReceipts,responsiveBindings,textPaintPackets,contract),measurements=normalizeFidelityMeasurements(responsive.measurements,program,compiled,stateReceipts),observations=stateReceipts.flatMap(receipt=>receipt.observations);
    bindSourceScrollEvidence(stateReceipts,textPaintPackets);const fidelity=verifyFidelity(contract,program,measurements,observations,catalogRenders,captured.presentationEvidence,textPaintPackets),textPaint=compareBoundTextPaint(contract,program,responsive.measurements,textPaintPackets),backgroundMedia=verifyNativeBackgroundMedia(program,compiled,schemas,assets,measurements),catalogRolePaint=compareCatalogRolePaint(contract,program,textPaintPackets,catalogRenders);
    for(const issue of catalogRolePaint.issues){fidelity.issues.push(issue);fidelity.passed=false;if(issue.severity==='error'){fidelity.structurePassed=false;fidelity.status='failed';}else if(fidelity.status==='passed')fidelity.status='needs-review';}addScrollEvidenceGaps(fidelity,stateReceipts);
    for(const receipt of stateReceipts)if(receipt.documentWidth>receipt.viewportWidth+4){fidelity.passed=false;fidelity.structurePassed=false;fidelity.status='failed';fidelity.issues.push({code:'document-overflow',severity:'error',viewport:receipt.viewport,message:'Actual document exceeds viewport width beyond pixel tolerance',expected:receipt.viewportWidth,actual:receipt.documentWidth});}
    runtime.phase('local-region-pixel-comparison');
    const visual=await verifyVisualAcceptance({contract,program,sourceViewports:viewportPlan.viewports,measurements,presentationEvidence:captured.presentationEvidence,sourcePackets:textPaintPackets,sourceJobDir,runDir,planGaps:viewportPlan.gaps,catalogRenders,catalogRolePaint});
    const after=await client.snapshotDraft(snapshot.pageId);requireSame(after);
    const frontendPassed=fidelity.passed&&textPaint.passed&&backgroundMedia.passed&&catalogRolePaint.passed&&nativeDocument.passed&&visual.passed&&sourceCoverage.passed;
    const completion=fidelityCompletion({
      data:verdict(nativeDocument.passed&&(fidelity.productChecks??[]).every(check=>check.status==='verified'),(fidelity.productChecks??[]).some(check=>check.status==='failed')),
      visual:verdict(visual.passed&&textPaint.passed&&backgroundMedia.passed&&fidelity.presentationDetails.passed&&catalogRolePaint.passed,visual.status==='failed'||textPaint.status==='failed'||catalogRolePaint.status==='failed'||fidelity.presentationDetails.status==='failed'||!backgroundMedia.passed),
      behavior:verdict(fidelity.statesVerified,fidelity.issues.some(issue=>issue.severity==='error'&&/state|interaction|hover|carousel/.test(issue.code))),
      responsive:verdict(viewports.every(view=>measurements.some(actual=>actual.name===view.name&&actual.width===view.width))&&fidelity.coverage.every(view=>view.expectedBlocks===view.matchedBlocks)&&!fidelity.issues.some(issue=>/overflow|geometry|content-bounds|viewport/.test(issue.code)),fidelity.issues.some(issue=>issue.severity==='error'&&/overflow|geometry|content-bounds|viewport/.test(issue.code))),
      evidence:verdict(sourceCoverage.passed&&viewportPlan.gaps.length===0&&visual.issues.every(issue=>issue.severity!=='warning'),sourceCoverage.status==='failed'),
      issues:[...fidelity.issues,...visual.issues,...sourceCoverage.issues],limitations:fidelity.limitations,
    });
    const passed=completion.passed,verificationPath=path.join(runDir,'verification/frontend-final.json');
    runtime.finish();
    const report={version:1,workflow:'block-replication',readOnly:true,sourceOfStates:'fresh',passed,status:completion.status,completion,frontendPassed,visual,sourceCoverage,viewportPlan,snapshotHash:after.hash,beforeHash:before.hash,afterHash:after.hash,targetDocumentWrites:0,targetMediaWrites:0,writerCountsScope:'Explicit WordPress document/media writer API calls; not a claim of zero browser network requests',browserNetworkPolicy:{allowedMethods:['GET','HEAD'],webSocketsBlocked:true,blockedMutationRequests:rawMeasurements.reduce((sum,view)=>sum+(view.networkPolicy?.blockedMutationRequests??0),0)},editorVisited:false,runtime:{...runtime.snapshot(),viewportNavigationCount:captured.navigationCount,readOnlyViewportConcurrency:Math.min(2,viewports.length),sharedViewportSessions:true},fidelity,presentationEvidence:captured.presentationEvidence,presentationDetails:fidelity.presentationDetails,textPaint,backgroundMedia,nativeDocument,measurements,rawMeasurements,stateReceipts,catalogRenders,catalogRolePaint,responsiveTextBindings:responsive.receipts,blocksBuilt:contract.blocks.length,nativeElements:flattenNative(program.elements).length,limitations:fidelity.limitations};
    await writeJson(path.join(runDir,'verification/target-catalog-render.json'),{catalog:catalog??null,renders:catalogRenders});await writeJson(path.join(runDir,'verification/catalog-role-paint.json'),catalogRolePaint);await writeJson(path.join(runDir,'verification/text-paint-final.json'),textPaint);await writeJson(path.join(runDir,'verification/native-background-media.json'),backgroundMedia);await writeJson(verificationPath,report);return{passed,verificationPath,snapshot:after,report};
  }finally{await browser.close();}
}
