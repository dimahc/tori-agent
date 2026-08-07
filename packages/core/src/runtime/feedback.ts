// packages/core/src/runtime/feedback.ts
// Event emitter + cancellation registry for progress reporting.

import type { ProgressEvent, CancellationToken, FeedbackChannel } from '../types/feedback.js';

const progressListeners = new Set<(event: ProgressEvent) => void>();
const cancelled = new Set<string>();

export function emitProgress(event: ProgressEvent): void {
  for (const listener of progressListeners) {
    listener(event);
  }
}

export function createCancellationToken(): CancellationToken {
  return {
    cancel(sessionId: string): void {
      cancelled.add(sessionId);
    },
    isCancelled(sessionId: string): boolean {
      return cancelled.has(sessionId);
    },
  };
}

export function createFeedbackChannel(): FeedbackChannel {
  return {
    onProgress(callback: (event: ProgressEvent) => void): void {
      progressListeners.add(callback);
    },
    offProgress(callback: (event: ProgressEvent) => void): void {
      progressListeners.delete(callback);
    },
  };
}

export function clearCancellation(sessionId: string): void {
  cancelled.delete(sessionId);
}
