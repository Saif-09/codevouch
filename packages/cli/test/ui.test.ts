import { describe, it, expect, afterEach } from 'vitest';
import { wrap, pad, stripAnsi, bar, gauge, sparkline, deltaBars, glyph } from '../src/ui.js';
import { spinner, withSpinner } from '../src/spinner.js';

/** Capture everything written to stdout, with the terminal state we choose. */
function capture(tty: boolean) {
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  const realTty = process.stdout.isTTY;
  const realCols = process.stdout.columns;
  (process.stdout as any).isTTY = tty;
  (process.stdout as any).columns = 72;
  (process.stdout as any).write = (s: any) => {
    chunks.push(String(s));
    return true;
  };
  return {
    text: () => chunks.join(''),
    restore: () => {
      (process.stdout as any).write = realWrite;
      (process.stdout as any).isTTY = realTty;
      (process.stdout as any).columns = realCols;
    },
  };
}

let cap: { text: () => string; restore: () => void } | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

describe('drawing helpers', () => {
  it('wraps prose to the terminal and indents the continuation lines', () => {
    const lines = wrap('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', 2).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(72);
    expect(lines[0].startsWith(' ')).toBe(false);
    for (const l of lines.slice(1)) expect(l.startsWith('  ')).toBe(true);
  });

  it('leaves room on the first line for a label already printed there', () => {
    const long = 'x'.repeat(30);
    const first = wrap(`${long} ${long} ${long}`, 2, 60).split('\n')[0];
    expect(first).toBe(long); // 60 used + 30 does not fit, so it breaks immediately
  });

  it('wrapping an empty string yields an empty string, not a stray indent', () => {
    expect(wrap('', 2)).toBe('');
  });

  it('pads and measures around colour codes', () => {
    const coloured = '\x1b[2mfoo\x1b[0m';
    expect(stripAnsi(coloured)).toBe('foo');
    expect(stripAnsi(pad(coloured, 10))).toHaveLength(10);
  });

  it('bars fill in proportion and never overflow their width', () => {
    for (const [v, expected] of [[0, 0], [50, 5], [100, 10]] as const) {
      expect(stripAnsi(bar(v, 100, 10)).split(glyph.barEmpty)[0]).toHaveLength(expected);
    }
    expect(stripAnsi(bar(9999, 100, 10))).toHaveLength(10); // clamped
    expect(stripAnsi(bar(5, 0, 10))).toHaveLength(10); // no division by zero
    expect(stripAnsi(gauge(42))).toMatch(/ 42%$/);
  });

  it('sparklines are one glyph per point and flat data does not divide by zero', () => {
    expect([...sparkline([1, 2, 3, 4])]).toHaveLength(4);
    expect([...sparkline([5, 5, 5])]).toHaveLength(3);
    expect(sparkline([])).toBe('');
  });

  it('the delta draws both numbers as bars', () => {
    const out = stripAnsi(deltaBars(5, 1));
    expect(out).toContain('5/7');
    expect(out).toContain('1/7');
    expect(out.split('\n')).toHaveLength(2);
  });
});

describe('the loader', () => {
  it('writes one plain line with no cursor motion when stdout is not a TTY', () => {
    cap = capture(false);
    const sp = spinner('checking things');
    sp.succeed('done checking');
    const out = cap.text();
    expect(stripAnsi(out)).toBe('checking things... done checking\n');
    expect(out).not.toContain('\r'); // nothing to redraw in a pipe
    expect(out).not.toContain('\x1b[2K');
    expect(out).not.toContain('\x1b[?25l'); // and the cursor is never hidden
  });

  it('animates, clocks and closes with a tick on a TTY', async () => {
    cap = capture(true);
    const sp = spinner('working');
    await new Promise((r) => setTimeout(r, 200));
    sp.succeed('worked');
    const out = cap.text();
    expect(out).toContain('\x1b[?25l'); // cursor hidden while spinning
    expect(out).toContain('\x1b[?25h'); // and restored on the way out
    expect(out).toContain('\r\x1b[2K'); // redrawn in place, never a new line
    expect(stripAnsi(out)).toContain(`${glyph.tick} worked`);
    // exactly one line is left behind, however many frames were drawn
    expect(out.match(/\n/g) ?? []).toHaveLength(1);
  });

  it('a nested wait borrows the line instead of animating a second one', () => {
    cap = capture(true);
    const outer = spinner('outer work');
    const inner = spinner('inner work');
    expect(cap.text()).toContain('inner work'); // the specific message wins
    inner.stop();
    expect(cap.text()).toContain('outer work'); // and the outer label comes back
    outer.succeed();
    expect(cap.text().match(/\n/g) ?? []).toHaveLength(1);
  });

  it('swaps in a patience message once a wait stops being quick', async () => {
    cap = capture(true);
    const sp = spinner('starting', { patience: [{ afterMs: 50, text: 'still going, here is why' }] });
    await new Promise((r) => setTimeout(r, 220));
    sp.stop();
    expect(cap.text()).toContain('still going, here is why');
  });

  it('withSpinner returns the value, and marks the line failed without swallowing the error', async () => {
    cap = capture(true);
    expect(await withSpinner('fetching', async () => 42, { done: 'fetched' })).toBe(42);
    expect(stripAnsi(cap.text())).toContain(`${glyph.tick} fetched`);

    await expect(withSpinner('fetching', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(stripAnsi(cap.text())).toContain(`${glyph.cross} fetching`);
  });

  it('a transient wait writes nothing at all into a pipe', async () => {
    cap = capture(false);
    await withSpinner('reading the map', async () => 1, { transient: true });
    // no dangling "reading the map..." in a redirect, where nothing can be erased
    expect(cap.text()).toBe('');
  });

  it('a transient spinner leaves nothing behind', async () => {
    cap = capture(true);
    await withSpinner('quiet work', async () => 1, { transient: true });
    // nothing is committed to the scrollback at all: no newline was written
    expect(cap.text()).not.toContain('\n');
    // ...and the line it was using is erased, with the cursor put back
    expect(cap.text().endsWith('\r\x1b[2K\x1b[?25h')).toBe(true);
  });
});
