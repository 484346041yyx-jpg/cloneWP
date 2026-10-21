/** Source blocks are frozen independently of the authored Elementor program. */
import type { PresentationBinding, PresentationDetails, PresentationGap } from './presentation-contract.js';
import type { SourceSceneBinding } from '../reference/source-scene.js';
import type { SourceCoverageReport } from './source-coverage.js';
export type BlockPresentation = 'static' | 'grid' | 'carousel' | 'accordion' | 'navigation' | 'form';
export type EvidenceState = { status: 'observed' | 'not-applicable' | 'unobserved'; evidence: string[]; note?: string; properties?: Record<string, string | number | boolean> };
export interface NativeElement { key: string; type: string; settings: Record<string, unknown>; children?: NativeElement[] }
export interface BlockText { id: string; text: string; kind: 'heading' | 'body' | 'label' | 'product-name' | 'price' | 'rating' | 'navigation' | 'other' }
/** The evidenced horizontal content box is separate from a full-width painted block. */
export interface ContentBounds {
  x: number; width: number; viewportWidth: number; sourceNodeId: string; evidence: string[];
}
/** Only evidenced repeated item data may be replaced by the target's catalog. */
export interface CatalogSourceData {
  provider: 'target-woocommerce'; kind: 'product-list';
  replaceableTextIds: string[]; replaceableAssetKeys: string[];
  items: Array<{ sourceNodeId: string; sourceNodeIds?: Record<string, string>; textIds: string[]; assetKeys: string[]; evidence: string[] }>;
  evidence: string[];
}
export interface NativeProductQuery {
  provider: 'target-woocommerce'; widgetKey: string; widgetType: 'wd_products';
  sourceTextIds: string[]; sourceAssetKeys: string[]; queryControlKeys: string[];
  /** Source card typography remains evidence even when its product data is replaced. */
  styleBindings?: { nameSourceTextIds: string[]; priceSourceTextIds: string[] };
  carouselMode?: { control: string; value: string }; evidence: string[];
}
export interface BlockContract {
  version: 1; workflow: 'block-replication'; sourceUrl: string; capturedAt: string;
  referenceReport: { path: string; sha256: string };
  evidence: Array<{ id: string; path: string; sha256: string; kind: 'dom' | 'screenshot' | 'interaction' | 'observation' }>;
  tolerances: { geometryPx: number; geometryRatio: number; colorChannel: number };
  /** Maps independent source inventory facts; the compiler cannot shrink the source denominator. */
  sourceSceneBindings?: SourceSceneBinding[];
  blocks: Array<{
    id: string; role: string; presentation: BlockPresentation; requiredWidgetTypes?: string[];
    texts: BlockText[]; assets: string[]; evidence: string[];
    geometry: Record<string, { width: number; height: number; columns?: number }>;
    contentBounds?: Record<string, ContentBounds>;
    presentationDetails?: PresentationDetails;
    dynamicData?: CatalogSourceData;
    colors: Record<string, string>;
    states: { normal: EvidenceState; hover: EvidenceState; interaction: EvidenceState };
  }>;
  limitations: string[];
}
export interface SourceAssetManifest {
  version: 1; sourceUrl: string; downloadedAt: string;
  assets: Array<{ key: string; sourceUrl: string; localPath: string; sha256: string; alt: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; provenance: string }>;
}
export interface NativeProgram {
  version: 1; workflow: 'block-replication'; title: string; sourceUrl: string;
  sourceContract: { path: string; sha256: string }; assetsManifest: { path: string; sha256: string };
  elements: NativeElement[];
  blocks: Array<{
    sourceBlockId: string; rootKey: string; presentation: BlockPresentation;
    /** Maps each measured source content box to a native element inside this block. */
    contentBindings?: Record<string, string>;
    presentationBindings?: PresentationBinding[];
    presentationGaps?: PresentationGap[];
    productQuery?: NativeProductQuery;
    bindings: Array<{ sourceTextId: string; elementKey: string; settingPath: string }>;
    states: { normal: EvidenceState; hover: EvidenceState; interaction: EvidenceState };
  }>;
  deviations: Array<{ blockId: string; category: 'geometry' | 'behavior' | 'asset' | 'data' | 'state'; reason: string; evidence: string[] }>;
}
export interface FidelityPreparedJob {
  version: 1; workflow: 'block-replication'; mode?: 'replica'; jobId: string; url: string; jobDir: string;
  status: 'awaiting-block-contract' | 'blocked'; referencePath: string; referenceReportSha256?: string;
  contractPath: string; assetsManifestPath: string; programPath: string; error?: string;
}
export interface FidelityAudit {
  version: 1; workflow: 'block-replication'; passed: boolean; programPath: string;
  programSha256: string; contractSha256: string; assetsManifestSha256: string;
  blocks: number; nativeElements: number; textBindings: number;
  assets: SourceAssetManifest['assets']; limitations: string[];
  sourceCoverage?: SourceCoverageReport;
  status?: 'passed' | 'needs-review' | 'failed';
}
