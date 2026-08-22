import { daemon, repoRoot } from '../../lib/daemon';

export const dynamic = 'force-dynamic';

export default async function ConceptsPage() {
  const root = await repoRoot();
  const enc = encodeURIComponent(root);
  const rows = await daemon<any[]>(`/concepts?root=${enc}`);

  return (
    <main>
      <h1>what to study</h1>
      <p className="muted">sorted by the gap: where your confidence ran furthest ahead of what you could produce</p>
      <nav aria-label="views">
        <a href="/">map</a>
        <a href="/concepts" aria-current="page">what to study</a>
      </nav>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>no graded reps yet. run <code>vouch digest</code> after a work session.</p>
      ) : (
        <table>
          <thead>
            <tr><th scope="col">gap</th><th scope="col">node</th><th scope="col">zone</th><th scope="col">state</th><th scope="col">reps</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`gapnum${r.gap < 0 ? ' neg' : ''}`}>{r.gap > 0 ? '+' : ''}{Number(r.gap).toFixed(1)}</td>
                <td>{r.label}</td>
                <td>{r.zone}</td>
                <td>{r.state}</td>
                <td>{r.reps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
