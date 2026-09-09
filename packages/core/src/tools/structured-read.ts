import { open, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export const STRUCTURED_READ_MODES = [
  "stat",
  "slice_bytes",
  "slice_chars",
  "json_pointer",
  "object_keys",
  "pretty",
] as const;

export type StructuredReadMode = (typeof STRUCTURED_READ_MODES)[number];

const MAX_SLICE_BYTES = 8192;
const MAX_SLICE_CHARS = 8192;
const MAX_RENDER_CHARS = 16384;
const MAX_OBJECT_KEYS = 256;

type StructuredReadFormat = "json" | "text" | "base64";

interface StructuredReadProjection {
  surface: "structured_read";
  classification: "derived-operational-view";
  authoritative: false;
  readonly: true;
  generated_at: string;
  reproducible_from: ["project file bytes"];
}

interface StructuredReadMetadata {
  readonly: true;
  path: string;
  mode: StructuredReadMode;
  format: StructuredReadFormat;
  file_bytes: number;
  truncated: boolean;
  truncation: {
    applied: boolean;
    reason: "none" | "limit";
    requested?: number;
    returned?: number;
    limit?: number;
  };
}

interface StructuredReadResult {
  projection: StructuredReadProjection;
  metadata: StructuredReadMetadata;
  result: Record<string, unknown>;
}

function buildProjection(): StructuredReadProjection {
  return {
    surface: "structured_read",
    classification: "derived-operational-view",
    authoritative: false,
    readonly: true,
    generated_at: new Date().toISOString(),
    reproducible_from: ["project file bytes"],
  };
}

function requireMode(value: unknown): StructuredReadMode {
  if (typeof value !== "string" || !STRUCTURED_READ_MODES.includes(value as StructuredReadMode)) {
    throw new Error(`structured_read mode must be one of: ${STRUCTURED_READ_MODES.join(", ")}`);
  }
  return value as StructuredReadMode;
}

function requirePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("structured_read path required");
  }
  return value;
}

function integerArg(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`structured_read ${name} must be non-negative integer`);
  }
  return Number(value);
}

function normalizeProjectPath(projectRoot: string, inputPath: string): { resolvedPath: string; relativePath: string } {
  const resolvedPath = resolve(projectRoot, inputPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  if (!resolvedPath.startsWith(normalizedRoot) && resolvedPath !== resolve(projectRoot)) {
    throw new Error(`Path escapes project root: ${inputPath}`);
  }
  const relativePath = relative(projectRoot, resolvedPath) || ".";
  return { resolvedPath, relativePath };
}

async function statFile(projectRoot: string, inputPath: string): Promise<{ resolvedPath: string; relativePath: string; fileBytes: number }> {
  const { resolvedPath, relativePath } = normalizeProjectPath(projectRoot, inputPath);
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) {
    throw new Error(`structured_read requires regular file: ${relativePath}`);
  }
  return {
    resolvedPath,
    relativePath,
    fileBytes: metadata.size,
  };
}

function buildMetadata(
  path: string,
  mode: StructuredReadMode,
  format: StructuredReadFormat,
  fileBytes: number,
  truncation: StructuredReadMetadata["truncation"],
): StructuredReadMetadata {
  return {
    readonly: true,
    path,
    mode,
    format,
    file_bytes: fileBytes,
    truncated: truncation.applied,
    truncation,
  };
}

function buildResponse(
  metadata: StructuredReadMetadata,
  result: Record<string, unknown>,
): StructuredReadResult {
  return {
    projection: buildProjection(),
    metadata,
    result,
  };
}

function readTextSlice(source: string, offsetChars: number, requestedChars: number): {
  text: string;
  truncation: StructuredReadMetadata["truncation"];
} {
  const cappedChars = Math.min(requestedChars, MAX_SLICE_CHARS);
  return {
    text: source.slice(offsetChars, offsetChars + cappedChars),
    truncation: requestedChars > MAX_SLICE_CHARS
      ? { applied: true, reason: "limit", requested: requestedChars, returned: cappedChars, limit: MAX_SLICE_CHARS }
      : { applied: false, reason: "none", requested: requestedChars, returned: cappedChars, limit: MAX_SLICE_CHARS },
  };
}

function truncateText(source: string, requestedChars = source.length): {
  text: string;
  truncation: StructuredReadMetadata["truncation"];
} {
  const cappedChars = Math.min(source.length, MAX_RENDER_CHARS);
  return {
    text: source.slice(0, cappedChars),
    truncation: source.length > MAX_RENDER_CHARS
      ? { applied: true, reason: "limit", requested: requestedChars, returned: cappedChars, limit: MAX_RENDER_CHARS }
      : { applied: false, reason: "none", requested: requestedChars, returned: cappedChars, limit: MAX_RENDER_CHARS },
  };
}

function parseJson(text: string, mode: StructuredReadMode): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`structured_read ${mode} requires valid JSON: ${detail}`);
  }
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new Error("structured_read json_pointer pointer must be empty or start with '/'");
  }
  const tokens = pointer.split("/").slice(1).map(decodeJsonPointerToken);
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token)) {
        throw new Error(`structured_read json_pointer missing token: ${pointer}`);
      }
      const index = Number(token);
      if (index < 0 || index >= current.length) {
        throw new Error(`structured_read json_pointer missing token: ${pointer}`);
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      throw new Error(`structured_read json_pointer missing token: ${pointer}`);
    }
    const record = current as Record<string, unknown>;
    if (!(token in record)) {
      throw new Error(`structured_read json_pointer missing token: ${pointer}`);
    }
    current = record[token];
  }
  return current;
}

function jsonValueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export async function structuredRead(projectRoot: string, rawArgs: Record<string, unknown>): Promise<StructuredReadResult> {
  const mode = requireMode(rawArgs.mode);
  const inputPath = requirePath(rawArgs.path ?? rawArgs.filePath);
  const { resolvedPath, relativePath, fileBytes } = await statFile(projectRoot, inputPath);

  if (mode === "stat") {
    return buildResponse(
      buildMetadata(relativePath, mode, "json", fileBytes, { applied: false, reason: "none" }),
      {
        file_kind: "file",
        size_bytes: fileBytes,
      },
    );
  }

  if (mode === "slice_bytes") {
    const offsetBytes = integerArg(rawArgs.offset_bytes ?? rawArgs.offset, "offset_bytes", 0);
    const requestedBytes = integerArg(rawArgs.length_bytes ?? rawArgs.length, "length_bytes", MAX_SLICE_BYTES);
    const cappedBytes = Math.min(requestedBytes, MAX_SLICE_BYTES);
    const buffer = Buffer.alloc(cappedBytes);
    const handle = await open(resolvedPath, "r");
    try {
      const { bytesRead } = await handle.read(buffer, 0, cappedBytes, offsetBytes);
      const slice = buffer.subarray(0, bytesRead);
      return buildResponse(
        buildMetadata(
          relativePath,
          mode,
          "base64",
          fileBytes,
          requestedBytes > MAX_SLICE_BYTES
            ? { applied: true, reason: "limit", requested: requestedBytes, returned: bytesRead, limit: MAX_SLICE_BYTES }
            : { applied: false, reason: "none", requested: requestedBytes, returned: bytesRead, limit: MAX_SLICE_BYTES },
        ),
        {
          offset_bytes: offsetBytes,
          returned_bytes: bytesRead,
          data_base64: slice.toString("base64"),
          preview_utf8: slice.toString("utf8"),
        },
      );
    } finally {
      await handle.close();
    }
  }

  const text = await readFile(resolvedPath, "utf8");

  if (mode === "slice_chars") {
    const offsetChars = integerArg(rawArgs.offset_chars ?? rawArgs.offset, "offset_chars", 0);
    const requestedChars = integerArg(rawArgs.length_chars ?? rawArgs.length, "length_chars", MAX_SLICE_CHARS);
    const { text: slice, truncation } = readTextSlice(text, offsetChars, requestedChars);
    return buildResponse(
      buildMetadata(relativePath, mode, "text", fileBytes, truncation),
      {
        offset_chars: offsetChars,
        returned_chars: slice.length,
        text: slice,
      },
    );
  }

  const document = parseJson(text, mode);

  if (mode === "json_pointer") {
    const pointer = typeof rawArgs.pointer === "string" ? rawArgs.pointer : "";
    const value = resolveJsonPointer(document, pointer);
    const rendered = truncateText(JSON.stringify(value));
    return buildResponse(
      buildMetadata(relativePath, mode, "text", fileBytes, rendered.truncation),
      {
        pointer,
        value_kind: jsonValueKind(value),
        text: rendered.text,
      },
    );
  }

  if (mode === "object_keys") {
    const pointer = typeof rawArgs.pointer === "string" ? rawArgs.pointer : "";
    const value = resolveJsonPointer(document, pointer);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`structured_read object_keys requires object at pointer: ${pointer || "/"}`);
    }
    const keys = Object.keys(value as Record<string, unknown>);
    const returnedKeys = keys.slice(0, MAX_OBJECT_KEYS);
    return buildResponse(
      buildMetadata(
        relativePath,
        mode,
        "json",
        fileBytes,
        keys.length > MAX_OBJECT_KEYS
          ? { applied: true, reason: "limit", requested: keys.length, returned: returnedKeys.length, limit: MAX_OBJECT_KEYS }
          : { applied: false, reason: "none", requested: keys.length, returned: returnedKeys.length, limit: MAX_OBJECT_KEYS },
      ),
      {
        pointer,
        total_keys: keys.length,
        keys: returnedKeys,
      },
    );
  }

  const rendered = truncateText(JSON.stringify(document, null, 2));
  return buildResponse(
    buildMetadata(relativePath, mode, "text", fileBytes, rendered.truncation),
    {
      text: rendered.text,
    },
  );
}
