import type { NativeElement, NativeProgram } from './types.js';
import type { SourcePaintAtom, SourceTextPaintPacket } from './text-paint.js';
import type { TargetElementEvidence } from '../verification/types.js';
import { readSettingPath } from './validate.js';
import { sourceVisibleText } from './check.js';

export interface InactiveSourceTextProof { evidence:string[]; selectors:string[] }
const flatten=(nodes:NativeElement[]):NativeElement[]=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
/** Hidden target DOM alone never exempts source copy. All independently
 * observed same-block occurrences must actually have zero source geometry. */
export function proveInactiveSourceText(blockId:string,text:string,viewport:string,packets:SourceTextPaintPacket[]):InactiveSourceTextProof|undefined{
  const expected=sourceVisibleText(text);
  if(!expected)return;
  const candidates=packets.filter(packet=>packet.viewport===viewport).flatMap(packet=>(packet.blocks.find(block=>block.id===blockId)?.textAtoms??[]).filter(atom=>sourceVisibleText(atom.text??'')===expected||sourceVisibleText(atom.fullElementText??'')===expected).map(atom=>({atom,evidence:packet.evidencePath})));
  const hidden=(atom:SourcePaintAtom)=>atom.visible===false&&!!atom.selector&&!!atom.rect&&Number.isFinite(atom.rect.width)&&Number.isFinite(atom.rect.height)&&atom.rect.width>=0&&atom.rect.height>=0&&(atom.rect.width===0||atom.rect.height===0);
  if(!candidates.length||!candidates.every(candidate=>!!candidate.evidence&&hidden(candidate.atom)))return;
  return{evidence:[...new Set(candidates.map(candidate=>candidate.evidence))],selectors:[...new Set(candidates.map(candidate=>candidate.atom.selector!))]};
}
/** A closed native details element can have empty innerText while its editable
 * text setting remains saved. Nonempty contradictory browser text is rejected. */
export function retainedHiddenNativeText(program:NativeProgram,blockId:string,sourceTextId:string,text:string,target:TargetElementEvidence|undefined):boolean{
  const block=program.blocks.find(block=>block.sourceBlockId===blockId),bindings=block?.bindings.filter(binding=>binding.sourceTextId===sourceTextId)??[];
  if(!block||bindings.length!==1||!target?.found||!target.nativeElement||target.count!==1||target.visible!==false||target.sourceId!==bindings[0].elementKey)return false;
  const roots=program.elements.filter(node=>node.key===block.rootKey),nodes=flatten(roots).filter(node=>node.key===bindings[0].elementKey);
  if(roots.length!==1||nodes.length!==1)return false;
  const saved=readSettingPath(nodes[0].settings,bindings[0].settingPath),expected=sourceVisibleText(text);
  if(typeof saved!=='string'||!expected||sourceVisibleText(saved)!==expected)return false;
  const observed=sourceVisibleText(target.text);
  return !observed||observed.includes(expected);
}
