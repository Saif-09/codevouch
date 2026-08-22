import { daemon, repoRoot } from '../lib/daemon';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const root = await repoRoot();
  const enc = encodeURIComponent(root);
  const [status, map] = await Promise.all([
    daemon<any>(`/status?root=${enc}`),
    daemon<{ svg: string }>(`/map/svg?root=${enc}&w=1100&h=640`),
  ]);
  const worstGap = status.gapPerZone[0];

  return (
    <main>
      <h1>{status.repo}</h1>
      <p className="muted">the comprehension map: what you can defend, what you only met once, what nobody asked you about yet</p>
      <nav aria-label="views">
        <a href="/" aria-current="page">map</a>
        <a href="/concepts">what to study</a>
      </nav>
      <div className="stats">
        <div className="stat good">
          <b>{status.vouchedPct === null ? 'n/a' : `${Math.floor(status.vouchedPct)}%`}</b>
          <span className="muted">vouched: code you demonstrated you can defend</span>
        </div>
        {worstGap && (
          <div className="stat gap">
            <b>{worstGap.gap > 0 ? '+' : ''}{worstGap.gap.toFixed(1)}</b>
            <span className="muted">the gap in {worstGap.zoneName}: self-rating minus demonstrated</span>
          </div>
        )}
      </div>
      <div className="mapwrap" dangerouslySetInnerHTML={{ __html: map.svg }} />
      <p className="muted" style={{ marginTop: 10 }}>
        area is weight (critical code counts 3x) · colour is state · hatched means it decayed · pale cells are code you chose to outsource
      </p>
    </main>
  );
}
