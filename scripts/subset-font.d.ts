/**
 * Minimal typing for `subset-font`, which ships none.
 *
 * Declared narrowly, to the one call this project makes, rather than pulled in
 * as `any`: a wrong argument here silently produces a subset missing glyphs,
 * and the failure only shows up as empty boxes in a browser.
 */
declare module 'subset-font' {
  interface SubsetFontOptions {
    readonly targetFormat?: 'woff' | 'woff2' | 'truetype' | 'sfnt';
    readonly variationAxes?: Readonly<Record<string, { min?: number; max?: number; default?: number }>>;
  }

  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
