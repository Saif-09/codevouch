import type { MapModel, MapCell } from './map.js';

/**
 * One SVG source of truth: the dashboard inlines it, the PNG rasterizes it.
 *
 * Palette is validator-locked (tech spec §10): the state scale is an ordinal
 * lightness ladder because lightness survives every kind of colour vision.
 * `decayed` additionally carries a 45° hatch so the map survives greyscale.
 * Cells keep a 2px paper gap; labels wear ink or paper by fill lightness,
 * never the series colour as text.
 */
export const PALETTE = {
  paper: '#F4F0E8',
  ink: '#1B1A17',
  oxblood: '#7A2E28',
  brass: '#B08A4A',
  verdigris: '#4E7B77',
  chalk: '#D7D0C4',
} as const;

export function cellFill(cell: { state: string; inZone: boolean }): string {
  if (!cell.inZone) return PALETTE.chalk;
  switch (cell.state) {
    case 'defended':
      return PALETTE.verdigris;
    case 'explained':
    case 'predicted':
      return PALETTE.brass;
    default:
      return PALETTE.oxblood; // unknown, decayed (decayed adds hatch)
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LABEL_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const STAT_FONT = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";

function cellSvg(c: MapCell): string {
  const fill = cellFill(c);
  const pale = fill === PALETTE.chalk;
  const dark = fill === PALETTE.oxblood || fill === PALETTE.verdigris;
  const hatch = c.inZone && c.state === 'decayed';
  const gap = 2; // paper gap between fills
  const x = c.x + gap / 2;
  const y = c.y + gap / 2;
  const w = Math.max(0, c.w - gap);
  const h = Math.max(0, c.h - gap);
  if (w < 1 || h < 1) return '';

  const title = `${c.label} (${c.kind}, ${c.inZone ? c.state : 'out of zone'}${c.critical ? ', critical' : ''})`;
  const label =
    w > 68 && h > 22
      ? `<text x="${x + 6}" y="${y + 15}" font-family=${JSON.stringify(LABEL_FONT)} font-size="11" font-weight="600" fill="${dark ? PALETTE.paper : PALETTE.ink}">${esc(c.label.slice(0, Math.floor(w / 7)))}</text>`
      : '';

  return [
    `<g tabindex="0" role="img" aria-label="${esc(title)}" class="cell">`,
    `<title>${esc(title)}</title>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"${pale ? ` stroke="${PALETTE.ink}" stroke-opacity="0.25" stroke-width="1"` : ''}/>`,
    hatch ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#decayhatch)"/>` : '',
    label,
    `</g>`,
  ].join('');
}

export interface MapSvgOptions {
  width: number;
  height: number;
  showLegend?: boolean;
}

export function renderMapSvg(model: MapModel, opts: MapSvgOptions): string {
  const { width, height } = opts;
  const legendH = opts.showLegend === false ? 0 : 34;
  const mapH = height - legendH;

  const groupLabels = model.groups
    .filter((g) => g.w > 76 && g.h > 34)
    .map(
      (g) =>
        `<text x="${g.x + 6}" y="${g.y + g.h - 6}" font-family=${JSON.stringify(LABEL_FONT)} font-size="10" fill="${PALETTE.ink}" opacity="0.55">${esc(g.name)}</text>`,
    )
    .join('');

  const legend =
    legendH === 0
      ? ''
      : legendSvg(8, mapH + 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Comprehension map">
<defs>
  <pattern id="decayhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="7" stroke="${PALETTE.paper}" stroke-width="2.5"/>
  </pattern>
  <style>
    .cell:focus { outline: none; }
    .cell:focus rect:first-of-type { stroke: ${PALETTE.ink}; stroke-width: 2.5; stroke-opacity: 1; }
    @media (hover: hover) { .cell:hover rect:first-of-type { stroke: ${PALETTE.ink}; stroke-width: 1.5; stroke-opacity: 0.8; } }
  </style>
</defs>
<rect x="0" y="0" width="${width}" height="${height}" fill="${PALETTE.paper}"/>
${model.groups.map((g) => g.cells.map(cellSvg).join('')).join('')}
${groupLabels}
${legend}
</svg>`;
}

export function legendSvg(x: number, y: number): string {
  const entries: [string, string, boolean][] = [
    ['unknown', PALETTE.oxblood, false],
    ['explained', PALETTE.brass, false],
    ['defended', PALETTE.verdigris, false],
    ['decayed', PALETTE.oxblood, true],
    ['out of zone', PALETTE.chalk, false],
  ];
  let cx = x;
  const parts: string[] = [];
  for (const [name, fill, hatch] of entries) {
    parts.push(`<rect x="${cx}" y="${y}" width="14" height="14" rx="2" fill="${fill}"${fill === PALETTE.chalk ? ` stroke="${PALETTE.ink}" stroke-opacity="0.25"` : ''}/>`);
    if (hatch) parts.push(`<rect x="${cx}" y="${y}" width="14" height="14" rx="2" fill="url(#decayhatch)"/>`);
    parts.push(`<text x="${cx + 19}" y="${y + 11}" font-family=${JSON.stringify(LABEL_FONT)} font-size="11" fill="${PALETTE.ink}">${name}</text>`);
    cx += 19 + name.length * 6.2 + 18;
  }
  return `<g aria-label="legend">${parts.join('')}</g>`;
}

/** The 1200x630 share composition: stats left, treemap right (Wave 1 spec §4). */
export function renderShareSvg(
  model: MapModel,
  repoName: string,
  gapHeadline: { zoneName: string; gap: number } | null,
): string {
  const W = 1200;
  const H = 630;
  const statW = 380;
  const pct = model.vouchedPct;

  const inner = renderMapSvg(
    { ...model, groups: rescaleGroups(model, statW + 24, 24, W - statW - 48, H - 88) },
    { width: W, height: H, showLegend: false },
  )
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(`<rect x="0" y="0" width="${W}" height="${H}" fill="${PALETTE.paper}"/>`, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>
<text x="48" y="92" font-family=${JSON.stringify(STAT_FONT)} font-size="34" fill="${PALETTE.ink}">${escText(repoName)}</text>
<text x="48" y="230" font-family=${JSON.stringify(STAT_FONT)} font-size="104" fill="${PALETTE.ink}">${pct === null ? 'n/a' : `${Math.floor(pct)}%`}</text>
<text x="48" y="266" font-family=${JSON.stringify(LABEL_FONT)} font-size="16" fill="${PALETTE.ink}" opacity="0.7">vouched: code its owner can defend</text>
${gapHeadline ? `<text x="48" y="356" font-family=${JSON.stringify(STAT_FONT)} font-size="46" fill="${PALETTE.oxblood}">+${gapHeadline.gap.toFixed(1)}</text>
<text x="48" y="384" font-family=${JSON.stringify(LABEL_FONT)} font-size="15" fill="${PALETTE.ink}" opacity="0.7">the gap: overconfidence in ${escText(gapHeadline.zoneName)}</text>` : ''}
<text x="48" y="${H - 44}" font-family=${JSON.stringify(LABEL_FONT)} font-size="13" fill="${PALETTE.ink}" opacity="0.45">vouch</text>
${inner}
${legendSvg(statW + 24, H - 52)}
<defs>
  <pattern id="decayhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="7" stroke="${PALETTE.paper}" stroke-width="2.5"/>
  </pattern>
</defs>
</svg>`;
}

function escText(s: string): string {
  return esc(s);
}

function rescaleGroups(model: MapModel, ox: number, oy: number, w: number, h: number) {
  const maxX = Math.max(1, ...model.groups.map((g) => g.x + g.w));
  const maxY = Math.max(1, ...model.groups.map((g) => g.y + g.h));
  const sx = w / maxX;
  const sy = h / maxY;
  return model.groups.map((g) => ({
    ...g,
    x: ox + g.x * sx,
    y: oy + g.y * sy,
    w: g.w * sx,
    h: g.h * sy,
    cells: g.cells.map((c) => ({
      ...c,
      x: ox + c.x * sx,
      y: oy + c.y * sy,
      w: c.w * sx,
      h: c.h * sy,
    })),
  }));
}

/**
 * The audit card: the one artifact worth showing someone else. Numbers only,
 * no package names and no repository contents, so it is safe to post.
 */
export function renderAuditSvg(a: {
  repo: string;
  scanned: number;
  vulnerable: number;
  worstSeverity: string | null;
  deprecated: number;
  stale: number;
  unused: number;
  unusedInstallBytes: number;
  totalInstallBytes: number;
}): string {
  const W = 1200;
  const H = 630;
  const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
  const alarming = a.vulnerable > 0 || a.deprecated > 0;

  const stat = (x: number, y: number, value: string, label: string, colour: string) => `
    <text x="${x}" y="${y}" font-family=${JSON.stringify(STAT_FONT)} font-size="74" fill="${colour}">${esc(value)}</text>
    <text x="${x}" y="${y + 30}" font-family=${JSON.stringify(LABEL_FONT)} font-size="15" fill="${PALETTE.ink}" opacity="0.7">${esc(label)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>
<text x="64" y="96" font-family=${JSON.stringify(STAT_FONT)} font-size="38" fill="${PALETTE.ink}">${esc(a.repo)}</text>
<text x="64" y="128" font-family=${JSON.stringify(LABEL_FONT)} font-size="16" fill="${PALETTE.ink}" opacity="0.65">${a.scanned} direct dependencies, ${mb(a.totalInstallBytes)} installed</text>
${stat(64, 250, String(a.vulnerable), a.worstSeverity ? `with known vulnerabilities (worst: ${a.worstSeverity.toLowerCase()})` : 'with known vulnerabilities', a.vulnerable > 0 ? PALETTE.oxblood : PALETTE.verdigris)}
${stat(64, 380, String(a.deprecated), 'deprecated by their own authors', a.deprecated > 0 ? PALETTE.oxblood : PALETTE.verdigris)}
${stat(640, 250, String(a.unused), `imported by nothing (${mb(a.unusedInstallBytes)} of dead weight)`, a.unused > 0 ? PALETTE.brass : PALETTE.verdigris)}
${stat(640, 380, String(a.stale), 'with no release in over two years', a.stale > 0 ? PALETTE.brass : PALETTE.verdigris)}
<line x1="64" y1="470" x2="${W - 64}" y2="470" stroke="${PALETTE.ink}" stroke-opacity="0.15" stroke-width="1"/>
<text x="64" y="510" font-family=${JSON.stringify(LABEL_FONT)} font-size="15" fill="${PALETTE.ink}" opacity="0.75">${alarming ? 'Found in about twenty seconds, with one command.' : 'Clean. Checked, not assumed.'}</text>
<text x="64" y="534" font-family=${JSON.stringify(LABEL_FONT)} font-size="13" fill="${PALETTE.ink}" opacity="0.5">Sources: OSV advisory database, deps.dev, the npm registry.</text>
<text x="64" y="${H - 44}" font-family=${JSON.stringify(LABEL_FONT)} font-size="14" fill="${PALETTE.ink}" opacity="0.55">npm install -g codevouch</text>
<text x="${W - 64}" y="${H - 44}" text-anchor="end" font-family=${JSON.stringify(LABEL_FONT)} font-size="14" fill="${PALETTE.ink}" opacity="0.4">vouch audit</text>
</svg>`;
}
