import { buildPlugin } from '@tori-agent/core';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const runtime = 'kilocode';
const projectRoot = new URL('../../../', import.meta.url).pathname;
const localCandidates = [
  `${projectRoot}.kilo`,
  `${projectRoot}.kilocode`,
  `${homedir()}/.config/${runtime}`,
  `${homedir()}/.config/kilo`,
];
const detectedDir = localCandidates.find((d) => existsSync(d)) ?? localCandidates[localCandidates.length - 1];
const configPath = `${detectedDir}/AGENTS.md`;

export default buildPlugin({ runtime, configPath });
