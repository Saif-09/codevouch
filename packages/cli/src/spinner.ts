import { glyph, paint, stripAnsi, width } from './ui.js';

/**
 * The loader. Vouch waits on two slow things: model calls that write cards and
 * grade answers, and the keyless feeds it checks every dependency against. Both
 * can run tens of seconds, and a terminal that shows nothing during those reads
 * as a hang, so every wait longer than a blink gets one of these.
 *
 * Rules it has to obey:
 *  - No motion and no escape codes when stdout is not a TTY. Piped output, CI
 *    logs and the post-commit hook get one plain line, the way they did before.
 *  - Elapsed time once the wait stops being instant. A spinner with no clock
 *    still looks stuck at fifteen seconds.
 *  - One line at a time. A command that already has a spinner up and then hits
 *    a slow layer underneath (the daemon spawning, say) must not animate two
 *    lines over each other: the inner wait borrows the outer line instead.
 *  - The cursor always comes back, including on ctrl-c and on a crash.
 */

const INTERVAL_MS = 80;
const CLOCK_AFTER_MS = 1200;

export interface Patience {
  /** Swap in a new line once the wait has run this long. */
  afterMs: number;
  text: string;
}

export interface SpinnerOpts {
  /** Longer waits deserve an explanation, not a faster spinner. */
  patience?: Patience[];
  /**
   * This wait is meant to vanish when it finishes. On a TTY the line is erased;
   * in a pipe, where nothing can be erased, it is never written in the first
   * place, so redirected output has no dangling "reading the map..." in it.
   */
  transient?: boolean;
}

export interface Spinner {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  /** Erase the line and leave nothing behind. */
  stop(): void;
  elapsedMs(): number;
}

let cursorHidden = false;
function hideCursor(): void {
  if (!cursorHidden && process.stdout.isTTY) {
    process.stdout.write('\x1b[?25l');
    cursorHidden = true;
  }
}
function showCursor(): void {
  if (cursorHidden) {
    process.stdout.write('\x1b[?25h');
    cursorHidden = false;
  }
}
// A hidden cursor that outlives the process is the worst thing a CLI can leave
// behind, so this is registered once, at import.
process.on('exit', showCursor);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    showCursor();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

function clock(ms: number): string {
  if (ms < CLOCK_AFTER_MS) return '';
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** Trim to the terminal so a long label never wraps into a second line. */
function fit(s: string, reserved: number): string {
  const room = width() - reserved;
  const plain = stripAnsi(s);
  return plain.length <= room ? s : `${plain.slice(0, Math.max(0, room - 1))}…`;
}

/** The spinner that owns the line right now, if any. */
let active: { sp: Spinner; label: () => string } | null = null;

export function spinner(text: string, opts: SpinnerOpts = {}): Spinner {
  const { patience = [], transient = false } = opts;
  const start = Date.now();
  const elapsedMs = () => Date.now() - start;

  // Nested wait: describe it on the line that is already spinning, and put the
  // outer label back when it finishes.
  if (active) {
    const parent = active;
    const restore = parent.label();
    parent.sp.update(text);
    let closed = false;
    const release = () => {
      if (closed) return;
      closed = true;
      parent.sp.update(restore);
    };
    return {
      update: (t) => parent.sp.update(t),
      succeed: release,
      fail: release,
      stop: release,
      elapsedMs,
    };
  }

  const tty = Boolean(process.stdout.isTTY) && !/^(1|true)$/i.test(process.env.VOUCH_NO_SPINNER ?? '');
  let label = text;

  if (!tty) {
    // One line, written once, and only for a wait that leaves something behind.
    if (!transient) process.stdout.write(paint.dim(`${label}... `));
    let closed = false;
    const close = (suffix: string | null) => {
      if (closed) return;
      closed = true;
      active = null;
      if (!transient && suffix !== null) process.stdout.write(`${suffix}\n`);
    };
    const flat: Spinner = {
      update: (t) => { label = t; },
      succeed: (t) => close(paint.dim(t ?? 'done')),
      fail: (t) => close(paint.dim(t ?? 'failed')),
      stop: () => close(null),
      elapsedMs,
    };
    active = { sp: flat, label: () => label };
    return flat;
  }

  let frame = 0;
  const pending = [...patience].sort((a, b) => a.afterMs - b.afterMs);
  let live = true;

  const draw = () => {
    const ms = elapsedMs();
    while (pending.length > 0 && ms >= pending[0].afterMs) label = pending.shift()!.text;
    const spun = paint.accent(glyph.spinner[frame++ % glyph.spinner.length]);
    const t = clock(ms);
    const tail = t ? `  ${paint.dim(t)}` : '';
    process.stdout.write(`\r\x1b[2K${spun} ${fit(label, 4 + stripAnsi(tail).length)}${tail}`);
  };

  hideCursor();
  draw();
  const timer = setInterval(draw, INTERVAL_MS);
  // Never hold the event loop open on the spinner's account.
  timer.unref();

  const end = () => {
    live = false;
    active = null;
    clearInterval(timer);
  };

  const finish = (mark: string, t?: string) => {
    if (!live) return;
    const ms = clock(elapsedMs());
    end();
    process.stdout.write(`\r\x1b[2K${mark} ${fit(t ?? label, 4)}${ms ? `  ${paint.dim(ms)}` : ''}\n`);
    showCursor();
  };

  const sp: Spinner = {
    update: (t) => {
      label = t;
      if (live) draw();
    },
    succeed: (t) => finish(paint.good(glyph.tick), t),
    fail: (t) => finish(paint.bad(glyph.cross), t),
    stop: () => {
      if (!live) return;
      end();
      process.stdout.write('\r\x1b[2K');
      showCursor();
    },
    elapsedMs,
  };
  active = { sp, label: () => label };
  return sp;
}

export interface WithSpinnerOpts<T> extends SpinnerOpts {
  /** The line left behind on success. A function sees the resolved value. */
  done?: string | ((value: T) => string);
}

/**
 * Run one promise under a spinner. On rejection the line is marked failed and
 * the error is rethrown untouched, so callers keep their own error handling.
 */
export async function withSpinner<T>(
  text: string,
  work: () => Promise<T>,
  opts: WithSpinnerOpts<T> = {},
): Promise<T> {
  const sp = spinner(text, opts);
  try {
    const value = await work();
    if (opts.transient) sp.stop();
    else sp.succeed(typeof opts.done === 'function' ? opts.done(value) : opts.done);
    return value;
  } catch (e) {
    sp.fail();
    throw e;
  }
}
