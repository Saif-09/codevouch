import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

/** Local rasterization: no account, no upload, no network call (spec §10). */
export function svgToPngFile(svg: string, outPath: string): void {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
    background: '#F4F0E8',
  });
  writeFileSync(outPath, resvg.render().asPng());
}
