import type { MapModel } from './map.js';
/**
 * One SVG source of truth: the dashboard inlines it, the PNG rasterizes it.
 *
 * Palette is validator-locked (tech spec §10): the state scale is an ordinal
 * lightness ladder because lightness survives every kind of colour vision.
 * `decayed` additionally carries a 45° hatch so the map survives greyscale.
 * Cells keep a 2px paper gap; labels wear ink or paper by fill lightness,
 * never the series colour as text.
 */
export declare const PALETTE: {
    readonly paper: "#F4F0E8";
    readonly ink: "#1B1A17";
    readonly oxblood: "#7A2E28";
    readonly brass: "#B08A4A";
    readonly verdigris: "#4E7B77";
    readonly chalk: "#D7D0C4";
};
export declare function cellFill(cell: {
    state: string;
    inZone: boolean;
}): string;
export interface MapSvgOptions {
    width: number;
    height: number;
    showLegend?: boolean;
}
export declare function renderMapSvg(model: MapModel, opts: MapSvgOptions): string;
export declare function legendSvg(x: number, y: number): string;
/** The 1200x630 share composition: stats left, treemap right (Wave 1 spec §4). */
export declare function renderShareSvg(model: MapModel, repoName: string, gapHeadline: {
    zoneName: string;
    gap: number;
} | null): string;
