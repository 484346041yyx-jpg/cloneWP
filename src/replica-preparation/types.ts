import type { Native44Component, Native44Program } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { BodySourceUnits } from '../replica-full/body-prepare.js';
import type { FullReplicaFileRef, FullReplicaSourcePartition } from '../replica-full/types.js';
import type { HeaderModulePlan } from '../woodmart-header/generic/contract.js';
import type { NavigationFormSpec } from '../replica-full/navigation-form/index.js';
import type { ResponsiveSource, ResponsiveSection, ResponsivePlan } from '../replica-responsive/contract.js';
import type { NativeImagePolicy } from '../replica-full/native-image-policy.js';

export type PreparationFileRef = FullReplicaFileRef;
export const PREPARATION_DECISION_KEYS = ['fonts', 'content-width', 'spacing', 'breakpoints', 'native-style'] as const;
export const PREPARATION_COMPATIBILITY_KEYS = ['page-shell', 'fonts', 'header-layout', 'motion', 'native-controls'] as const;
export interface PreparationSection {
  key: string; sourceUnitIds: string[]; sourceFactIds: string[];
  family: 'content' | 'interaction'; dependsOn: string[]; estimatedEffort: number;
}
/** A source-derived contract, not an already authored header/body product. */
export interface PreparationPlan {
  version: 1 | 2 | 3; kind: 'clonewp-replica-preparation'; taskId: string; runId: string;
  title: string; slug: string; sourceUrl: string; targetOrigin: string;
  sourceEvidence: PreparationFileRef; sourceFacts: PreparationFileRef; sourceUnits: PreparationFileRef;
  headerAssets: PreparationFileRef; bodyAssets: PreparationFileRef;
  bodyBase: Omit<Native44Program, 'blocks'>; headerBase: HeaderModulePlan;
  sourcePartition: FullReplicaSourcePartition;
  navigationForms?: NavigationFormSpec[];
  nativeImagePolicy?: NativeImagePolicy;
  responsive?: ResponsiveSource;
  shared: {
    decisions: Array<{ key: string; value: unknown; evidence: PreparationFileRef[] }>;
    compatibility: Array<{ key: typeof PREPARATION_COMPATIBILITY_KEYS[number]; status: 'verified' | 'not-applicable' | 'unresolved'; reason: string; evidence: PreparationFileRef[] }>;
    css: string;
  };
  sections: PreparationSection[];
}
export interface PreparationJob {
  version: 1; kind: 'clonewp-preparation-job'; taskId: string; runId: string;
  jobId: 'header' | 'body-1' | 'body-2'; responsibility: 'header' | 'body';
  contractHash: string; sharedHash: string;
  sectionKeys: string[]; sourceUnitIds: string[]; sourceFactIds: string[]; estimatedEffort: number;
}
export interface PreparationSectionResult { key: string; blocks: Native44Component[]; css: string; responsive?: ResponsiveSection }
export interface PreparationJobResult {
  version: 1; kind: 'clonewp-preparation-result'; taskId: string; runId: string;
  jobId: PreparationJob['jobId']; contractHash: string; sharedHash: string;
  header?: HeaderModulePlan; sections?: PreparationSectionResult[];
}
export interface PreparationMergeInputs { sourceFacts: SourceFactsV2; sourceUnits: BodySourceUnits }
export interface PreparationComponentPlan {
  version: 1; kind: 'task-native-body-component-plan'; taskId: string; sourceUrl: string; headerExcluded: true;
  modules: Array<{ key: string; sourceUnitIds: string[]; sourceFactIds: string[]; componentKeys: string[] }>;
}
export interface MergedPreparation {
  header: HeaderModulePlan; program: Native44Program; css: string; sourceUnits: BodySourceUnits;
  navigationForms?: NavigationFormSpec[];
  nativeImagePolicy?: NativeImagePolicy;
  responsive?: ResponsivePlan;
  componentPlan: PreparationComponentPlan; contractHash: string; sharedHash: string;
}
