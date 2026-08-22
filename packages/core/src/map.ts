import type { Db } from './db.js';

/** Squarified treemap (Bruls, Huizing, van Wijk) and the map model. */

export interface Rect { x: number; y: number; w: number; h: number }

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

interface Item { weight: number; [k: string]: any }

/** Lays out items (sorted desc) into rect, preserving order, squarified. */
export function squarify<T extends Item>(items: T[], rect: Rect): (T & Rect)[] {
  const total = items.reduce((a, b) => a + b.weight, 0);
  if (total <= 0 || items.length === 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: (T & Rect)[] = [];
  let row: T[] = [];
  let free = { ...rect };

  const worst = (r: T[], side: number): number => {
    const sum = r.reduce((a, b) => a + b.weight * scale, 0);
    let max = 0;
    let min = Infinity;
    for (const it of r) {
      const area = it.weight * scale;
      max = Math.max(max, area);
      min = Math.min(min, area);
    }
    const s2 = sum * sum;
    return Math.max((side * side * max) / s2, s2 / (side * side * min));
  };

  const layoutRow = (r: T[]) => {
    const sum = r.reduce((a, b) => a + b.weight * scale, 0);
    const horizontal = free.w >= free.h;
    const side = horizontal ? free.h : free.w;
    const thickness = side > 0 ? sum / side : 0;
    let offset = 0;
    for (const it of r) {
      const len = thickness > 0 ? (it.weight * scale) / thickness : 0;
      if (horizontal) {
        out.push({ ...it, x: free.x, y: free.y + offset, w: thickness, h: len });
      } else {
        out.push({ ...it, x: free.x + offset, y: free.y, w: len, h: thickness });
      }
      offset += len;
    }
    if (horizontal) {
      free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
    } else {
      free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    }
  };

  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  for (const it of sorted) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, it], side) <= worst(row, side)) {
      row.push(it);
    } else {
      layoutRow(row);
      row = [it];
    }
  }
  if (row.length > 0) layoutRow(row);
  return out;
}

interface NodeRow {
  id: string;
  kind: string;
  key: string;
  label: string;
  state: string;
  in_zone: number;
  critical: number;
}

export function buildMapModel(db: Db, repoId: string, width: number, height: number): MapModel {
  const rows = db
    .prepare(
      `SELECT id, kind, key, label, state, in_zone, critical
       FROM nodes WHERE repo_id = ? AND alive = 1`,
    )
    .all(repoId) as NodeRow[];

  const byGroup = new Map<string, NodeRow[]>();
  for (const n of rows) {
    const group =
      n.kind === 'dependency' ? 'dependencies'
      : n.kind === 'decision' ? 'features'
      : n.kind === 'concept' ? 'concepts'
      : n.key.includes('/') ? n.key.split('/')[0]
      : '(root)';
    const arr = byGroup.get(group) ?? [];
    arr.push(n);
    byGroup.set(group, arr);
  }

  const groupItems = [...byGroup.entries()].map(([name, nodes]) => ({
    name,
    nodes,
    weight: nodes.reduce((a, n) => a + (n.critical ? 3 : 1), 0),
  }));

  const laidGroups = squarify(groupItems, { x: 0, y: 0, w: width, h: height });
  const groups: MapGroup[] = laidGroups.map((g) => {
    const inner: Rect = { x: g.x + 2, y: g.y + 2, w: Math.max(0, g.w - 4), h: Math.max(0, g.h - 4) };
    const cells = squarify(
      g.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        state: n.state,
        inZone: n.in_zone === 1,
        critical: n.critical === 1,
        group: g.name,
        weight: n.critical ? 3 : 1,
      })),
      inner,
    );
    return { name: g.name, x: g.x, y: g.y, w: g.w, h: g.h, cells };
  });

  const zoneRows = rows.filter((n) => n.in_zone === 1 && n.kind !== 'concept');
  const den = zoneRows.reduce((a, n) => a + (n.critical ? 3 : 1), 0);
  const num = zoneRows.filter((n) => n.state === 'defended').reduce((a, n) => a + (n.critical ? 3 : 1), 0);

  return {
    groups,
    vouchedPct: den > 0 ? (100 * num) / den : null,
    totalNodes: rows.length,
  };
}
