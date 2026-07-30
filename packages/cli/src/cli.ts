import { main } from './index.js';

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});