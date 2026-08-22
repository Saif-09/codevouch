/**
 * node:sqlite is flagged experimental and Node announces that on every run.
 * That is our implementation detail, not something a user of a learning tool
 * should see.
 *
 * Overriding `process.emitWarning` does NOT suppress it: Node's internal
 * experimental-warning path is bound before user code runs. Measured, not
 * assumed. The only things that work are the `--no-warnings` flag (carried by
 * this package's shebang) and NODE_NO_WARNINGS=1 (set when we spawn the
 * daemon). This module keeps the process-level filter as a belt-and-braces
 * fallback for anyone invoking `main.js` directly with plain `node`.
 */
process.on('warning', (w) => {
  if (/SQLite is an experimental feature/i.test(w.message)) return;
  console.warn(w.stack ?? w.message);
});
