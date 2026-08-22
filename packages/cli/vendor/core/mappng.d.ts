/**
 * Local rasterisation: no account, no upload, no network call (spec §10).
 *
 * resvg is an OPTIONAL dependency. It ships prebuilt binaries for macOS,
 * Linux and Windows, but if it is missing or fails to load, Vouch writes the
 * SVG instead of failing. Losing PNG export should never cost someone the
 * whole tool.
 */
export declare class PngUnavailableError extends Error {
}
export declare function svgToPngFile(svg: string, outPath: string): Promise<string>;
