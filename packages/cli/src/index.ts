import { loadAndCompileAllAgents, detectRuntime } from '@tori-agent/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

function resolveOutputDir(outputDir: string): string {
  if (outputDir) return outputDir;
  const runtime = detectRuntime();
  const prefix = runtime === 'kilocode' ? '.kilo' : '.opencode';
  return join(prefix, 'agents');
}

function extForFormat(format: string): string {
  switch (format) {
    case 'yaml': return '.yaml';
    case 'md': return '.md';
    default: return '.json';
  }
}

function indexName(): string {
  return 'index.json';
}

function serializeIndex(manifest: { id: string; mode: string; promptLength: number; file: string }[]): string {
  return JSON.stringify(manifest, null, 2);
}

function serializeAgent(agent: unknown, format: string): string {
  switch (format) {
    case 'yaml': return yaml.dump(agent);
    case 'md': return formatAgentAsMarkdown(agent as Record<string, unknown>);
    default: return JSON.stringify(agent, null, 2);
  }
}

function formatAgentAsMarkdown(agent: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# ${agent.id}`);
  if (agent.description) lines.push(`\n${agent.description}\n`);
  const skip = ['id', 'description', 'prompt', 'permission'];
  for (const [key, value] of Object.entries(agent)) {
    if (skip.includes(key)) continue;
    lines.push(`- **${key}**: \`${value}\``);
  }
  lines.push(`\n## Prompt\n`);
  lines.push((agent.prompt as string) ?? '');
  lines.push(`\n## Permissions\n`);
  lines.push('```json');
  lines.push(JSON.stringify(agent.permission, null, 2));
  lines.push('```');
  return lines.join('\n');
}

async function handleGenerate(outputDir: string, format: string): Promise<void> {
  const targetDir = join(process.cwd(), outputDir);
  await mkdir(targetDir, { recursive: true });

  const agents = await loadAndCompileAllAgents();
  const manifest: { id: string; mode: string; promptLength: number; file: string }[] = [];

  for (const agent of agents) {
    const ext = extForFormat(format);
    const filename = `${agent.id}${ext}`;
    const filePath = join(targetDir, filename);
    await writeFile(filePath, serializeAgent(agent, format));
    manifest.push({
      id: agent.id,
      mode: agent.mode,
      promptLength: agent.prompt.length,
      file: filename,
    });
  }

  const indexPath = join(targetDir, indexName());
  await writeFile(indexPath, serializeIndex(manifest));

  console.log(`Generated ${agents.length} expanded agent(s) in ${outputDir}/`);
  for (const entry of manifest) {
    console.log(`  ${entry.id} — mode: ${entry.mode}, prompt: ${entry.promptLength} chars → ${entry.file}`);
  }
  console.log(`  Manifest: ${indexName()}`);
}

async function handleConfig(): Promise<void> {
  const runtime = detectRuntime();
  const configFile = runtime === 'kilocode' ? 'kilo.json' : 'opencode.json';
  const packageName = runtime === 'kilocode' ? '@tori-agent/runtime-kilocode' : '@tori-agent/runtime-opencode';

  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve(`${packageName}/package.json`);
  const configSource = join(dirname(pkgPath), configFile);
  const configContent = await readFile(configSource, 'utf-8');
  const targetPath = join(process.cwd(), configFile);

  await writeFile(targetPath, configContent);
  console.log(`Created ${configFile} in current directory`);
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'generate') {
    const outDirIndex = args.indexOf('--output');
    const outputDir = outDirIndex !== -1 && args[outDirIndex + 1] ? args[outDirIndex + 1] : '';
    const fmtIndex = args.indexOf('--format');
    const format = fmtIndex !== -1 && args[fmtIndex + 1] ? args[fmtIndex + 1] : 'json';
    const resolvedDir = resolveOutputDir(outputDir);
    await handleGenerate(resolvedDir, format);
    return;
  }

  if (command === 'config') {
    await handleConfig();
    return;
  }

  console.log('Usage: tori <command> [options]\n');
  console.log('Commands:');
  console.log('  generate [--output <dir>] [--format json|yaml|md]  Generate expanded agent files to disk');
  console.log('  config                                          Copy runtime config to current directory');
  console.log('  doctor                               Validate project configuration');
  console.log('  serve                                Start a local agent server');
}

import { fileURLToPath } from 'node:url';
const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}