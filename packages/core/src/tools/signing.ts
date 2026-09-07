/**
 * @file packages/core/src/tools/signing.ts
 * @description Spec signature verification.
 */

import { createVerify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function computeContentHash(content: string): string {
  // Simple hash for content integrity
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function verifySpecSignature(
  filePath: string,
  signature: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const publicKey = Buffer.from(publicKeyHex, 'hex');
    const verifier = createVerify('SHA256');
    const content = await readFile(filePath, 'utf-8');
    verifier.update(content);
    verifier.end();
    return verifier.verify(publicKey, signature, 'hex');
  } catch {
    return false;
  }
}