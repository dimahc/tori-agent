import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface SignatureInfo {
  algorithm: string;
  value: string;
}

export function parseSignature(signature?: string): SignatureInfo | null {
  if (!signature || typeof signature !== "string") return null;
  const match = /^([a-z0-9]+):([a-fA-F0-9]+)$/.exec(signature.trim());
  if (!match) return null;
  return { algorithm: match[1], value: match[2] };
}

export function computeContentHash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

export async function computeSkillContentHash(skillPath: string): Promise<string> {
  const entries = await readdir(skillPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(skillPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await readdir(full, { withFileTypes: true });
      for (const subEntry of sub) {
        files.push(join(full, subEntry.name));
      }
    } else {
      files.push(full);
    }
  }
  const sorted = files.sort((a, b) => a.localeCompare(b));
  const hashes = await Promise.all(sorted.map((f) => hashFile(f)));
  const combined = hashes.join("\n");
  return createHash("sha256").update(combined).digest("hex");
}

export async function verifySkillSignature(
  skillPath: string,
  signature?: string,
  publicKeyHex?: string,
): Promise<boolean> {
  const sig = parseSignature(signature);
  if (!sig) return false;
  if (sig.algorithm !== "ed25519") return false;
  if (!publicKeyHex) return false;

  try {
    const { verify } = await import("node:crypto");
    const contentHash = await computeSkillContentHash(skillPath);
    return verify(
      "sha256",
      Buffer.from(publicKeyHex, "hex"),
      Buffer.from(sig.value, "hex"),
      Buffer.from(contentHash, "utf-8"),
    );
  } catch {
    return false;
  }
}

export async function verifySpecSignature(
  filePath: string,
  signature?: string,
  publicKeyHex?: string,
): Promise<boolean> {
  const sig = parseSignature(signature);
  if (!sig) return false;
  if (sig.algorithm !== "ed25519") return false;
  if (!publicKeyHex) return false;

  try {
    const { verify } = await import("node:crypto");
    const content = await readFile(filePath, "utf-8");
    const contentHash = computeContentHash(content);
    return verify(
      "sha256",
      Buffer.from(publicKeyHex, "hex"),
      Buffer.from(sig.value, "hex"),
      Buffer.from(contentHash, "utf-8"),
    );
  } catch {
    return false;
  }
}
