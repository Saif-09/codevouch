import { runDaemon } from './server.js';

runDaemon().catch((e) => {
  console.error(e);
  process.exit(1);
});
