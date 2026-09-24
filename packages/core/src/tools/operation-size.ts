export function serializeOperationArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([key, value]) => `${key}:${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

export function measureOperationPayload(args: Record<string, unknown> | undefined): { operation_bytes: number; operation_lines: number } {
  const serialized = serializeOperationArgs(args);
  return {
    operation_bytes: Buffer.byteLength(serialized, "utf8"),
    operation_lines: serialized === "" ? 0 : serialized.split("\n").length,
  };
}