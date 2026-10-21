/** Neutral observation/measurement contracts shared by source and delivery.
 * No browser, authentication, persistence or comparison implementation belongs here. */
export interface Native44CompareGap {
  category: 'structure' | 'media' | 'query' | 'interaction' | 'evidence' | 'conflict';
  moduleKey?: string; viewport?: string; detail: string; blocking: boolean;
}
export interface Native44MeasuredModule {
  key: string; count: number; visible: boolean; box?: { x: number; y: number; width: number; height: number };
  css?: Record<string, string>; media?: Array<{ url: string; drawable: boolean | null; kind: string }>;
  state?: { carouselIndex?: number; expanded?: boolean; hover?: boolean };
  carouselRuntimeCount?: number;
}
