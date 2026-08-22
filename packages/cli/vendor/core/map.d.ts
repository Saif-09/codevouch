import type { Db } from './db.js';
/** Squarified treemap (Bruls, Huizing, van Wijk) and the map model. */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface MapCell extends Rect {
    id: string;
    label: string;
    kind: string;
    state: string;
    inZone: boolean;
    critical: boolean;
    weight: number;
    group: string;
}
export interface MapGroup extends Rect {
    name: string;
    cells: MapCell[];
}
export interface MapModel {
    groups: MapGroup[];
    vouchedPct: number | null;
    totalNodes: number;
}
interface Item {
    weight: number;
    [k: string]: any;
}
/** Lays out items (sorted desc) into rect, preserving order, squarified. */
export declare function squarify<T extends Item>(items: T[], rect: Rect): (T & Rect)[];
export declare function buildMapModel(db: Db, repoId: string, width: number, height: number): MapModel;
export {};
