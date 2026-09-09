import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OntologyCompiler } from '../dist/ontology/compiler.js';

const compiler = new OntologyCompiler();
await compiler.initialize();
const result = await compiler.compileAll();
const registry = compiler.getRegistry();

console.log('Ontology-native agent compilation:');
console.log(`  Graph entities: ${result.graph.length}`);
console.log(`  Agents: ${result.agents.length}`);
console.log(`  Roles: ${result.roles.length}`);
console.log(`  Capabilities: ${result.capabilities.length}`);
console.log(`  Tools: ${result.tools.length}`);
console.log(`  Workflow definitions: ${result.workflowDefinitions.length}`);
console.log(`  Workflow stages: ${result.workflowStages.length}`);
console.log(`  Workflow transitions: ${result.workflowTransitions.length}`);
console.log(`  Policies: ${result.policies.length}`);
console.log(`  Errors: ${result.errors.length}`);
console.log(`  Warnings: ${result.warnings.length}`);

const tori = registry.getByType('Agent').find(a => a['@id'] === 'agent:tori');
if (!tori) {
  console.error('ERROR: Tori agent not found');
  process.exit(1);
}

console.log('\nTori agent verified:');
console.log(`  ID: ${tori['@id']}`);
console.log(`  Prompt ref: ${tori.prompt_ref}`);
console.log(`  Roles: ${tori.role_ids?.length}`);
console.log(`  Capabilities: ${tori.capability_ids?.length}`);
console.log(`  Tools: ${tori.tool_ids?.length}`);

const workflow = registry.get('workflow:orchestration-pipeline');
console.log(`\nWorkflow: ${workflow?.label}`);
console.log(`  Stages: ${workflow?.stage_ids?.length}`);
console.log(`  Transitions: ${workflow?.transition_ids?.length}`);

const toriPrompt = await readFile(join(fileURLToPath(new URL('../spec/ontology/prompts/', import.meta.url)), 'tori.md'), 'utf8');
if (!/No self-talk in final output/i.test(toriPrompt)) {
  console.error('ERROR: Tori prompt missing anti-self-talk baseline');
  process.exit(1);
}

const policies = registry.getByType('Policy');
console.log(`\nPolicies: ${policies.map(p => p.label).join(', ')}`);

const stats = registry.getStats();
console.log(`\nRegistry stats:`);
console.log(`  Total entities: ${stats.totalEntities}`);
console.log(`  By type:`, stats.entitiesByType);

if (result.errors.length > 0 || result.agents.length === 0) {
  console.error('\nERROR: ontology compilation failed');
  for (const e of result.errors) {
    console.error(`  ${e.specId}: ${e.error}`);
  }
  process.exit(1);
}

console.log('\n✓ Ontology-native compilation successful');
process.exit(0);
