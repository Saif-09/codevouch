import readline from 'node:readline';
import pc from 'picocolors';

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

export async function confidence(prompt: string): Promise<number> {
  process.stdout.write(`${prompt} ${pc.dim('[1=no idea .. 7=certain]')} `);
  const ch = await keypress(['1', '2', '3', '4', '5', '6', '7']);
  process.stdout.write(`${ch}\n`);
  return Number(ch);
}

export function textInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt}\n${pc.dim('>')} `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Pick one of a small list by number. Recognition, not recall. */
export async function choose(options: string[]): Promise<string> {
  options.forEach((o, i) => {
    process.stdout.write(`  ${pc.bold(String(i + 1))}. ${o}\n`);
  });
  process.stdout.write(`${pc.dim('pick one [1-' + options.length + ']')} `);
  const ch = await keypress(options.map((_, i) => String(i + 1)));
  process.stdout.write(`${ch}\n`);
  return options[Number(ch) - 1];
}

export const paint = {
  title: (s: string) => pc.bold(s),
  dim: (s: string) => pc.dim(s),
  good: (s: string) => pc.green(s),
  warn: (s: string) => pc.yellow(s),
  bad: (s: string) => pc.red(s),
  em: (s: string) => pc.bold(pc.underline(s)),
};

export function hr(): void {
  process.stdout.write(pc.dim('─'.repeat(Math.min(process.stdout.columns ?? 60, 72))) + '\n');
}
