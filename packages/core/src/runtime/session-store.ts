import { readFileSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const DEBOUNCE_MS = 200;

let storePath = '';
let data: Record<string, { agent: string; timestamp: number }> = {};
let dirty = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function initSessionStore(configDir: string): void {
  storePath = join(configDir, '.tori-sessions.json');
  if (existsSync(storePath)) {
    try {
      data = JSON.parse(readFileSync(storePath, 'utf-8'));
    } catch {
      data = {};
    }
  }
}

function scheduleWrite(): void {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    if (!dirty) {
      writeTimer = null;
      return;
    }
    dirty = false;
    writeTimer = null;
    try {
      await mkdir(dirname(storePath), { recursive: true });
      await writeFile(storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[tori-core] Failed to persist sessions:', err);
    }
  }, DEBOUNCE_MS);
}

export function trackSessionAgent(sessionID: string, agent?: string): void {
  if (agent) {
    data[sessionID] = { agent, timestamp: Date.now() };
    scheduleWrite();
  }
}

export function agentForSession(sessionID: string): string | undefined {
  return data[sessionID]?.agent;
}

export function clearSession(sessionID: string): void {
  delete data[sessionID];
  scheduleWrite();
}

export function persistNow(): Promise<void> {
  dirty = false;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const dir = dirname(storePath);
  return mkdir(dir, { recursive: true }).then(() => writeFile(storePath, JSON.stringify(data, null, 2), 'utf-8'));
}
