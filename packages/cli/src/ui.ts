import readline from 'node:readline';
import pc from 'picocolors';

/**
 * Glyphs. Braille and box-drawing render correctly on every modern terminal,
 * but not on an old Windows console, and not in output someone is diffing.
 * VOUCH_ASCII=1 forces the plain set everywhere.
 */
const ASCII_ONLY =
  /^(1|true|yes)$/i.test(process.env.VOUCH_ASCII ?? '') ||
  (process.platform === 'win32' && !process.env.WT_SESSION && !process.env.TERM_PROGRAM);

export const glyph = ASCII_ONLY
  ? {
      tick: '+', cross: 'x', dot: '*', arrow: '->', chev: '>',
      bar: '#', barEmpty: '.', hr: '-', flag: '!',
      spinner: ['|', '/', '-', '\\'],
      spark: ['_', '.', '-', '~', '=', '*', '#', '@'],
    }
  : {
      tick: '✓', cross: '✗', dot: '·', arrow: '→', chev: '›',
      bar: '█', barEmpty: '░', hr: '─', flag: '⚑',
      spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
      spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
    };

export const paint = {
  title: (s: string) => pc.bold(s),
  dim: (s: string) => pc.dim(s),
  good: (s: string) => pc.green(s),
  warn: (s: string) => pc.yellow(s),
  bad: (s: string) => pc.red(s),
  em: (s: string) => pc.bold(pc.underline(s)),
  accent: (s: string) => pc.cyan(s),
};

/** Terminal width, clamped: long lines are harder to read, not more useful. */
export function width(max = 72): number {
  return Math.max(40, Math.min(process.stdout.columns ?? max, max));
}

export function hr(): void {
  process.stdout.write(paint.dim(glyph.hr.repeat(width())) + '\n');
}

/**
 * A rule with a title in it, and an optional right-aligned counter. This is
 * what makes a five-item digest feel like five items rather than a wall.
 *
 *   ── @paypal/paypal-server-sdk ─────────────────── 2/5 ──
 */
export function rule(label?: string, right?: string): void {
  if (!label) {
    hr();
    return;
  }
  const head = `${glyph.hr.repeat(2)} ${label} `;
  const tail = right ? ` ${right} ${glyph.hr.repeat(2)}` : '';
  const fill = Math.max(2, width() - head.length - tail.length);
  process.stdout.write(
    paint.dim(glyph.hr.repeat(2)) +
      ` ${paint.title(label)} ` +
      paint.dim(glyph.hr.repeat(fill)) +
      (right ? ` ${paint.dim(right)} ${paint.dim(glyph.hr.repeat(2))}` : '') +
      '\n',
  );
}

/** Every CSI sequence, not just colour: cursor moves and line clears too. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

/** Pad to a visible width, ignoring colour codes (padEnd counts them). */
export function pad(s: string, n: number): string {
  const len = stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, n - len));
}

/**
 * Wrap prose to the terminal. The reveal is the part of a rep people actually
 * read, and a paragraph that soft-wraps into column zero is noticeably harder
 * to read than one whose continuation lines sit under the text.
 *
 * `firstOffset` is how much of the first line a caller has already used up,
 * so `the answer: <long sentence>` breaks in the right place.
 */
export function wrap(text: string, indent = 2, firstOffset = 0): string {
  const w = width();
  const pre = ' '.repeat(indent);
  const out: string[] = [];
  let line = '';
  let room = w - firstOffset;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= room) {
      line += ` ${word}`;
    } else {
      out.push(line);
      line = word;
      room = w - indent;
    }
  }
  if (line) out.push(line);
  return out.map((l, i) => (i === 0 ? l : pre + l)).join('\n');
}

/** `label: prose`, wrapped, with the continuation lines indented. */
export function field(label: string, value: string, indent = 2): string {
  return `${paint.em(label)}: ${wrap(value, indent, label.length + 2)}`;
}

/**
 * A filled bar. By default colour tracks the value, so the shape reads before
 * the number does: that is right for a score where more is better. Pass `tone`
 * for anything where it is not, like the gap, where a long bar is bad news.
 */
export function bar(value: number, max: number, w = 24, tone?: (s: string) => string): string {
  const ratio = max === 0 ? 0 : Math.max(0, Math.min(value / max, 1));
  const filled = Math.round(ratio * w);
  const paintFill = tone ?? (ratio >= 0.67 ? paint.good : ratio >= 0.34 ? paint.warn : paint.bad);
  return `${paintFill(glyph.bar.repeat(filled))}${paint.dim(glyph.barEmpty.repeat(w - filled))}`;
}

/** A percentage as bar plus number, for Vouched %. */
export function gauge(pct: number, w = 22): string {
  return `${bar(pct, 100, w)}  ${String(Math.floor(pct)).padStart(3)}%`;
}

/** One line of history. Eight levels is plenty to see a direction. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  return values
    .map((v) => glyph.spark[Math.min(glyph.spark.length - 1, Math.floor(((v - lo) / span) * glyph.spark.length))])
    .join('');
}

/**
 * The delta, drawn. "You rated 5, you demonstrated 1" is the whole product,
 * and two stacked bars land it in a way that two numbers in a sentence do not.
 */
export function deltaBars(rated: number, demonstrated: number): string {
  const row = (label: string, v: number, tone?: (s: string) => string) =>
    `  ${paint.dim(pad(label, 13))}${bar(v, 7, 7, tone)} ${v}/7`;
  return [
    // The claim is neutral: a high self-rating is not itself good news. Only
    // what you actually showed gets coloured by how high it is.
    row('you rated', rated, paint.accent),
    row('you showed', demonstrated),
  ].join('\n');
}

/** One keypress from a fixed set; also accepts ctrl-c to bail. */
export function keypress(allowed: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('interactive input needs a TTY'));
      return;
    }
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    const onKey = (_str: string, key: { name?: string; sequence?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      }
      const ch = (key.sequence ?? key.name ?? '').toLowerCase();
      if (allowed.includes(ch)) {
        cleanup();
        resolve(ch);
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('keypress', onKey);
    };
    stdin.on('keypress', onKey);
  });
}

/** What each rung of the 1-to-7 actually claims, echoed back on the way in. */
const CONFIDENCE_WORDS = [
  '', 'no idea', 'vague', 'shaky', 'roughly', 'fairly sure', 'confident', 'certain',
];

export async function confidence(prompt: string): Promise<number> {
  process.stdout.write(`${wrap(prompt, 0)}\n  ${paint.dim('1 no idea')} ${paint.dim(glyph.hr.repeat(8))} ${paint.dim('7 certain')}  `);
  const ch = await keypress(['1', '2', '3', '4', '5', '6', '7']);
  const n = Number(ch);
  process.stdout.write(`${paint.accent(ch)} ${paint.dim(`(${CONFIDENCE_WORDS[n]})`)}\n`);
  return n;
}

export function textInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n${wrap(prompt, 0)}\n${paint.dim(glyph.chev)} `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Pick one of a small list by number. Recognition, not recall. */
export async function choose(options: string[]): Promise<string> {
  options.forEach((o, i) => {
    // Flow options are whole sentences: wrapped under the number, they read
    // as four choices rather than four paragraphs.
    process.stdout.write(`  ${paint.accent(String(i + 1))}. ${wrap(o, 5, 5)}\n`);
  });
  process.stdout.write(`${paint.dim(`pick one [1-${options.length}]`)} `);
  const ch = await keypress(options.map((_, i) => String(i + 1)));
  process.stdout.write(`${paint.accent(ch)}\n`);
  return options[Number(ch) - 1];
}
