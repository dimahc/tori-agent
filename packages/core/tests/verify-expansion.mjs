import { loadAndCompileAllAgents } from '../dist/codegen/loader.js';

// Failure threshold (documented decision):
// Every console.warn path in loader.ts is a genuine expansion failure for this
// gate — a missing spec/agents/ dir, a spec that fails to read/parse, a missing
// prompt file, or missing persona instructions all mean the agent expansion
// would silently lose agents in production. None of them are benign. Therefore
// we exit non-zero if ANY warning is emitted during loading. We additionally
// treat zero compiled agents as a failure (e.g. an empty spec/agents/ dir
// produces no warning at all), since a build that generates no agents is
// equally broken.
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
};

const agents = await loadAndCompileAllAgents();

console.warn = originalWarn;

console.log('Expanded agents:');
for (const a of agents) {
  console.log(`  ${a.id} — mode: ${a.mode}, prompt length: ${a.prompt.length}`);
}
console.log(`\nTotal: ${agents.length} agents`);

if (warnings.length > 0 || agents.length === 0) {
  console.error('ERROR: agent expansion did not fully succeed.');
  for (const w of warnings) {
    console.error(`  warning: ${w}`);
  }
  if (agents.length === 0) {
    console.error('  No agents were compiled.');
  }
  console.error(
    'Fix the broken agent spec/prompt files before merging — this is a CI gate.',
  );
  process.exit(1);
}

process.exit(0);
