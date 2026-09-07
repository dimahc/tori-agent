import { OntologyCompiler } from '../dist/ontology/compiler.js';

// Verify ontology-native agent compilation
const compiler = new OntologyCompiler();
await compiler.initialize();
const result = await compiler.compileAll();
const registry = compiler.getRegistry();

console.log('Ontology-native agent compilation:');
console.log(`  Agents: ${result.agents.length}`);
console.log(`  Roles: ${result.roles.length}`);
console.log(`  Capabilities: ${result.capabilities.length}`);
console.log(`  Skills: ${result.skills.length}`);
console.log(`  Tools: ${result.tools.length}`);
console.log(`  Workflows: ${registry.getByType('Workflow').length}`);
console.log(`  Stages: ${registry.getByType('Stage').length}`);
console.log(`  Transitions: ${registry.getByType('Transition').length}`);
console.log(`  Policies: ${registry.getByType('Policy').length}`);
console.log(`  Errors: ${result.errors.length}`);
console.log(`  Warnings: ${result.warnings.length}`);

// Verify tori agent exists with ontology-native behavior
const tori = registry.getByType('Agent').find(a => a.name === 'Tori');
if (!tori) {
  console.error('ERROR: Tori agent not found');
  process.exit(1);
}

console.log('\nTori agent verified:');
console.log(`  ID: ${tori['@id']}`);
console.log(`  Implements: ${tori.metadata?.implements?.join(', ')}`);
console.log(`  Roles: ${tori.roles?.length}`);
console.log(`  Capabilities: ${tori.capabilities?.length}`);
console.log(`  Tools: ${tori.tools?.length}`);

// Verify workflow
const wfId = tori.metadata?.implements?.[0];
if (wfId) {
  const wf = registry.get(wfId);
  console.log(`\nWorkflow: ${wf?.name}`);
  console.log(`  Stages: ${wf?.stages?.length}`);
  console.log(`  Transitions: ${wf?.transitions?.length}`);
}

// Verify policies linked to agent
const policies = registry.getRelated(tori['@id'], 'governedBy').filter(e => e['@type'] === 'Policy');
console.log(`\nPolicies: ${policies.map(p => p.name).join(', ')}`);

// Verify registry stats
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