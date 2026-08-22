import { writeFileSync } from 'node:fs';
/**
 * Local rasterisation: no account, no upload, no network call (spec §10).
 *
 * resvg is an OPTIONAL dependency. It ships prebuilt binaries for macOS,
 * Linux and Windows, but if it is missing or fails to load, Vouch writes the
 * SVG instead of failing. Losing PNG export should never cost someone the
 * whole tool.
 */
export class PngUnavailableError extends Error {
}
export async function svgToPngFile(svg, outPath) {
    let Resvg;
    try {
        ({ Resvg } = await import('@resvg/resvg-js'));
    }
    catch {
        const svgPath = outPath.replace(/\.png$/i, '') + '.svg';
        writeFileSync(svgPath, svg);
        throw new PngUnavailableError(`PNG export needs the optional @resvg/resvg-js package, which is not installed. Wrote ${svgPath} instead.`);
    }
    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
        background: '#F4F0E8',
    });
    writeFileSync(outPath, resvg.render().asPng());
    return outPath;
}
