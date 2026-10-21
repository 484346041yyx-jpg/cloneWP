/** IDs select existing records; their native display order is date DESC, ID DESC. */
export interface OriginalProductQuery { ids?: number[]; limit: number }
export interface OriginalProductDisplay {
  layout: 'grid' | 'carousel'; columns: number; tabletColumns?: number; mobileColumns?: number;
  /** Omit to use the native product template. Explicit changes require registered controls. */
  showPrice?: boolean; showRating?: boolean; hoverStyle?: string;
  arrows?: boolean; pagination?: 'none' | 'dots' | 'fraction'; autoplay?: boolean; autoplaySpeed?: number;
  loop?: boolean; scrollPerPage?: boolean;
}
export interface OriginalCarousel {
  slidesToShow: number; tabletSlidesToShow?: number; mobileSlidesToShow?: number; slidesToScroll?: number;
  arrows: boolean; pagination: 'none' | 'dots' | 'fraction'; autoplay: boolean; autoplaySpeed?: number;
  pauseOnHover?: boolean; pauseOnInteraction?: boolean; loop: boolean; speed?: number;
}
export interface OriginalHover {
  background?: string; color?: string; borderColor?: string; borderWidth?: number; radius?: number;
  /** Image opacity, represented by its actual native opacity_hover control. */
  opacity?: number;
}
export interface OriginalNode {
  key: string;
  kind: 'container' | 'heading' | 'text' | 'image' | 'button' | 'accordion' | 'products' | 'carousel';
  text?: string;
  headingTag?: 'h1' | 'h2' | 'h3' | 'p';
  href?: string;
  anchor?: string;
  asset?: string;
  alt?: string;
  items?: Array<{ title: string; content: string }>;
  children?: OriginalNode[];
  productQuery?: OriginalProductQuery;
  productDisplay?: OriginalProductDisplay;
  carousel?: OriginalCarousel;
  hover?: OriginalHover;
  style?: {
    direction?: 'row' | 'column'; tabletDirection?: 'row' | 'column'; mobileDirection?: 'row' | 'column';
    wrap?: 'nowrap' | 'wrap'; tabletWrap?: 'nowrap' | 'wrap'; mobileWrap?: 'nowrap' | 'wrap';
    width?: number; tabletWidth?: number; mobileWidth?: number; boxed?: boolean;
    justify?: string; alignItems?: string; align?: 'left' | 'center' | 'right';
    tabletJustify?: string; mobileJustify?: string; tabletAlignItems?: string; mobileAlignItems?: string;
    tabletAlign?: 'left' | 'center' | 'right'; mobileAlign?: 'left' | 'center' | 'right';
    gap?: number; tabletGap?: number; mobileGap?: number;
    padding?: number[]; tabletPadding?: number[]; mobilePadding?: number[];
    margin?: number[]; tabletMargin?: number[]; mobileMargin?: number[];
    background?: string; color?: string; borderColor?: string; borderWidth?: number; radius?: number;
    fontSize?: number; tabletFontSize?: number; mobileFontSize?: number; weight?: number; lineHeight?: number;
    imageHeight?: number; tabletImageHeight?: number; mobileImageHeight?: number;
    minHeight?: number; tabletMinHeight?: number; mobileMinHeight?: number;
  };
}
export interface OriginalDesign {
  version: 1;
  /** Historical designs may omit this; new authored tasks explicitly select their workflow. */
  workflow?: 'original-design';
  brand: string;
  title: string;
  language: string;
  description: string;
  tokens: { colors: Record<string, string>; font: string; contentWidth: number };
  assets: Array<{ key: string; path: string; alt: string; provenance: string }>;
  sections: OriginalNode[];
}
