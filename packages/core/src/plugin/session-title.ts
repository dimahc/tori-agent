export interface SessionTitleInput {
  sessionID: string;
  role?: string;
  message?: string;
  currentTitle?: string;
}

export interface SessionTitleOutput {
  title?: string;
  shouldRename?: boolean;
  source?: "first-user-request";
}

const MAX_TITLE_LENGTH = 80;

const PLACEHOLDER_TITLE_PATTERNS = [
  /^$/u,
  /^untitled(?:\s+(?:session|chat))?$/iu,
  /^new\s+(?:session|chat)$/iu,
  /^session$/iu,
  /^chat$/iu,
  /^session[-_\s]*\d+$/iu,
  /^chat[-_\s]*\d+$/iu,
  /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?$/iu,
  /^[0-9]{10,}$/u,
  /^[a-f0-9]{8}-[a-f0-9-]{8,}$/iu,
];

const NOISE_MESSAGE_PATTERNS = [
  /^(?:hi|hello|hey|yo|sup|gm|morning|afternoon|evening)$/iu,
  /^(?:ok|okay|k|cool|nice)$/iu,
  /^(?:thanks|thank you|thx)$/iu,
  /^(?:ping|test|testing)$/iu,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s!?.,:;\-–—]+$/u, "").trim();
}

function sanitizeForNoiseCheck(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateTitle(value: string, maxLength = MAX_TITLE_LENGTH): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.6) ? lastSpace : maxLength;
  return `${slice.slice(0, boundary).trimEnd()}…`;
}

export function isDefaultSessionTitle(value?: string | null): boolean {
  if (typeof value !== "string") return true;
  const normalized = normalizeWhitespace(value);
  return PLACEHOLDER_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function deriveSessionTitle(message: string): string | null {
  const normalized = normalizeWhitespace(message);
  if (!normalized) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;

  const noiseCandidate = sanitizeForNoiseCheck(normalized);
  if (!noiseCandidate) return null;
  if (NOISE_MESSAGE_PATTERNS.some((pattern) => pattern.test(noiseCandidate))) return null;

  const stripped = stripTrailingPunctuation(normalized);
  if (!stripped) return null;

  return truncateTitle(stripped);
}

export class SessionTitleTracker {
  private readonly firstMeaningfulTitles = new Map<string, string>();
  private readonly finalizedSessions = new Set<string>();

  observe(input: SessionTitleInput): SessionTitleOutput {
    const role = input.role ?? "user";

    if (input.currentTitle && !isDefaultSessionTitle(input.currentTitle)) {
      this.finalizedSessions.add(input.sessionID);
      return {};
    }

    if (role !== "user") return {};

    const candidate = typeof input.message === "string" ? deriveSessionTitle(input.message) : null;
    if (candidate && !this.firstMeaningfulTitles.has(input.sessionID)) {
      this.firstMeaningfulTitles.set(input.sessionID, candidate);
    }

    const firstMeaningfulTitle = this.firstMeaningfulTitles.get(input.sessionID);
    if (!firstMeaningfulTitle) return {};
    if (this.finalizedSessions.has(input.sessionID)) return {};

    this.finalizedSessions.add(input.sessionID);
    return {
      title: firstMeaningfulTitle,
      shouldRename: true,
      source: "first-user-request",
    };
  }
}
