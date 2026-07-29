let _toolSchema: { string: () => { describe: (s: string) => unknown } } | null = null;

export async function initToolSchema(): Promise<void> {
  if (_toolSchema !== null) return;
  try {
    const mod = await import('@opencode-ai/plugin/tool');
    _toolSchema = (mod as any).tool?.schema ?? null;
  } catch {
    _toolSchema = null;
  }
}

export function getToolSchema() {
  return _toolSchema;
}
