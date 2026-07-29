import { loadAndCompileAllAgents } from '../dist/codegen/loader.js';

const agents = await loadAndCompileAllAgents();
console.log('Expanded agents:');
for (const a of agents) {
  console.log(`  ${a.id} — mode: ${a.mode}, prompt length: ${a.prompt.length}`);
}
console.log(`\nTotal: ${agents.length} agents`);