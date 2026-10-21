import type { LaunchOptions } from 'playwright';
export interface SourceBrowserViewport {name:string;width:number;deviceFacts?:{innerWidth?:number;clientWidth?:number};sourceEvidencePath?:string}
/** Match observed browser chrome without injecting layout CSS into the document under test. */
export function sourceBrowserLaunchPlan(viewports:SourceBrowserViewport[]):{options:LaunchOptions;mode:'native-scrollbars'|'default';observations:Array<{viewport:string;gutter:number|null;evidence?:string}>}{
 const observations=viewports.map(view=>{const inner=view.deviceFacts?.innerWidth,client=view.deviceFacts?.clientWidth;const gutter=typeof inner==='number'&&typeof client==='number'&&Number.isFinite(inner)&&Number.isFinite(client)&&inner===view.width&&client>0&&client<=inner&&inner-client<=64?inner-client:null;return{viewport:view.name,gutter,evidence:view.sourceEvidencePath};});
 const native=observations.some(view=>view.gutter!==null&&view.gutter>0);
 return{mode:native?'native-scrollbars':'default',options:{headless:true,...(native?{ignoreDefaultArgs:['--hide-scrollbars']}: {})},observations};
}
