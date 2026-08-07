// packages/core/src/types/feedback.ts
// Progress reporting, streaming updates, and cancellation support.

export interface ProgressEvent {
  session_id: string;
  stage: string;
  percent: number;
  message: string;
  timestamp: string;
}

export interface CancellationToken {
  cancel(sessionId: string): void;
  isCancelled(sessionId: string): boolean;
}

export interface FeedbackChannel {
  onProgress(callback: (event: ProgressEvent) => void): void;
  offProgress(callback: (event: ProgressEvent) => void): void;
}

export class CancelledError extends Error {
  constructor(sessionId: string) {
    super(`Operation cancelled: ${sessionId}`);
    this.name = 'CancelledError';
  }
}
