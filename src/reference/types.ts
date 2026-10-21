import type { OriginalDesign } from '../original/types.js';

export type ReferenceRole = 'header' | 'hero' | 'services' | 'story' | 'process' | 'faq' | 'cta' | 'proof' | 'articles' | 'products' | 'categories' | 'gallery' | 'newsletter' | 'footer' | 'unknown';
export interface ReferenceRect { x: number; y: number; width: number; height: number }
export interface ReferenceColor { hex: string; weight: number; role?: 'background' | 'text' | 'accent' | 'border' }
export interface ReferenceSection {
  id: string; role: ReferenceRole; inferred: boolean; confidence: number;
  selector: string; rect: ReferenceRect; heading?: string; textPreview?: string;
  background?: string; columns?: number; gap?: number; padding?: number[];
  layout?: 'flex' | 'grid' | 'block'; direction?: string;
  imageSide?: 'left' | 'right' | 'background' | 'none';
}
export interface ReferenceViewport {
  name: string; width: number; height: number; title: string; pageHeight: number;
  deviceFacts?: { profile: 'desktop' | 'mobile' | 'touch'; innerWidth: number; clientWidth: number; devicePixelRatio: number; touch: boolean; coarsePointer: boolean };
  screenshotPath: string; domPath: string; evidencePath: string;
  headings: Array<{ level: number; text: string; selector: string; rect: ReferenceRect }>;
  navigation: Array<{ text: string; href: string; selector: string }>;
  ctas: Array<{ text: string; href?: string; tag: string; selector: string; rect: ReferenceRect }>;
  sections: ReferenceSection[];
  images: Array<{ url: string; alt: string; width: number; height: number; selector: string; loaded: boolean; rect: ReferenceRect }>;
  typography: Array<{ family: string; size: number; weight: string; lineHeight: string; count: number }>;
  colors: ReferenceColor[];
  layout: { contentWidth?: number; hero: { layout: 'split' | 'centered' | 'image-led' | 'text-led' | 'unknown'; imageSide?: 'left' | 'right' }; density: 'airy' | 'balanced' | 'dense'; cardColumns?: number; cornerStyle?: 'square' | 'soft' | 'round' };
  disclosures: string[];
  metadata: { description?: string; language?: string; canonical?: string; ogTitle?: string; ogDescription?: string; ogImage?: string; generator?: string; structuredDataTypes?: string[] };
  counts: Record<string, number>;
}
export interface ReferenceCaptureReport {
  version: 1; url: string; finalUrl?: string; capturedAt: string;
  status: 'complete' | 'partial' | 'blocked'; evidenceNotice: string;
  viewports: ReferenceViewport[];
  gaps: Array<{ code: string; message: string; viewport?: string; evidencePath?: string }>;
  artifactPath: string;
}
export interface BusinessProfile {
  version: 1; brand: string; language: string; description: string; demo: boolean;
  business: string; audience: string; goal: string;
  colors?: Record<string, string>;
  hero: { eyebrow: string; title: string; description: string; primaryLabel: string; secondaryLabel?: string };
  services: Array<{ key: string; title: string; description: string }>;
  story?: { title: string; paragraphs: string[] };
  process?: { title: string; steps: Array<{ title: string; description: string }> };
  articles?: { title: string; items: Array<{ key: string; title: string; description: string }> };
  faq: Array<{ title: string; content: string }>;
  cta: { title: string; description: string; label: string };
  assets: OriginalDesign['assets'];
}
export interface ReferenceTransfer {
  version: 1;
  nature: 'deterministic-starting-proposal';
  sourceUrl: string; targetBrand: string;
  adopted: Array<{ principle: string; evidence: string[]; targetKeys: string[]; transformation: string }>;
  omitted: Array<{ role: string; reason: string }>;
  originality: { sourceTextUsed: false; sourceMediaUsed: false; sourceTreeUsed: false; ownBusinessFactsOnly: true };
  limitations: string[];
}
export interface ReferencePreparedJob {
  version: 1; workflow: 'reference-to-original'; jobId: string; url: string;
  status: 'awaiting-business-profile' | 'awaiting-codex-design' | 'blocked'; jobDir: string;
  referenceReportSha256?: string;
  referencePath: string; profilePath: string; proposalPath?: string;
  transferPath?: string; generationBriefPath?: string;
  designPath?: string; error?: string;
}
