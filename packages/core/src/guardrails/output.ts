import type { OutputGovernancePolicy, WorkflowRun } from "@tori-agent/ontology";

export interface AssistantOutputAnalysis {
  normalizedParagraphCounts: Record<string, number>;
  normalizedSentenceCounts: Record<string, number>;
  repeatedParagraphs: string[];
  repeatedSentences: string[];
  selfTalkMarkers: string[];
}

export interface AssistantOutputDecision {
  action: "allow" | "rewrite" | "retry" | "block";
  text?: string;
  reason?: string;
  analysis: AssistantOutputAnalysis;
}

const SELF_TALK_MARKERS = [
  "let me think",
  "let me check",
  "i should",
  "i need to make sure",
  "i need to check",
  "i need to think",
  "i will first",
  "i'll first",
  "reconsider",
  "double check",
  "let's think",
  "thinking through",
] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function normalizeTextUnit(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function countNormalized(units: string[]): Record<string, number> {
  return units.reduce<Record<string, number>>((acc, unit) => {
    const normalized = normalizeTextUnit(unit);
    if (!normalized) return acc;
    acc[normalized] = (acc[normalized] ?? 0) + 1;
    return acc;
  }, {});
}

function repeatedKeys(counts: Record<string, number>, maxAllowed = 1): string[] {
  return Object.entries(counts)
    .filter(([, count]) => count > maxAllowed)
    .map(([key]) => key);
}

export function analyzeAssistantOutput(text: string, policy: OutputGovernancePolicy = {}): AssistantOutputAnalysis {
  const paragraphCounts = countNormalized(splitParagraphs(text));
  const sentenceCounts = countNormalized(splitSentences(text));
  const normalized = normalizeTextUnit(text);
  const selfTalkMarkers = SELF_TALK_MARKERS.filter((marker) => normalized.includes(marker));
  return {
    normalizedParagraphCounts: paragraphCounts,
    normalizedSentenceCounts: sentenceCounts,
    repeatedParagraphs: repeatedKeys(paragraphCounts, policy.max_repeated_paragraphs ?? 1),
    repeatedSentences: repeatedKeys(sentenceCounts, policy.max_repeated_sentences ?? 1),
    selfTalkMarkers,
  };
}

export function normalizeToolInvocationSignature(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${stableStringify(args)}`;
}

export function normalizeFailureSignature(toolName: string, args: Record<string, unknown>, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${normalizeToolInvocationSignature(toolName, args)}:${normalizeTextUnit(message)}`;
}

export function buildWorkflowProgressSignature(workflowRun: WorkflowRun): string {
  return stableStringify({
    related_artifact_ids: [...workflowRun.related_artifact_ids].sort(),
    task_record_index: workflowRun.task_record_index ?? {},
  });
}

function dedupeParagraphs(text: string): string {
  const seen = new Set<string>();
  return splitParagraphs(text)
    .filter((paragraph) => {
      const normalized = normalizeTextUnit(paragraph);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join("\n\n");
}

function stripSelfTalkParagraphs(text: string): string {
  return splitParagraphs(text)
    .filter((paragraph) => {
      const normalized = normalizeTextUnit(paragraph);
      return !SELF_TALK_MARKERS.some((marker) => normalized.includes(marker));
    })
    .join("\n\n");
}

function dedupeSentences(text: string): string {
  const sentences = splitSentences(text);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const sentence of sentences) {
    const normalized = normalizeTextUnit(sentence);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push(sentence);
  }
  return kept.join(" ").trim();
}

function policyExceeded(analysis: AssistantOutputAnalysis, policy: OutputGovernancePolicy): boolean {
  return (
    analysis.repeatedParagraphs.length > 0 ||
    analysis.repeatedSentences.length > 0 ||
    analysis.selfTalkMarkers.length > (policy.max_self_talk_markers ?? Number.MAX_SAFE_INTEGER)
  );
}

export function governAssistantOutputText(
  text: string,
  policy: OutputGovernancePolicy = {},
  attempt = 0,
): AssistantOutputDecision {
  const analysis = analyzeAssistantOutput(text, policy);
  const selfTalkCap = policy.max_self_talk_markers ?? Number.MAX_SAFE_INTEGER;
  const hasSelfTalk = analysis.selfTalkMarkers.length > selfTalkCap;
  if (!policyExceeded(analysis, policy)) {
    return { action: "allow", text, analysis };
  }

  const rewritten = dedupeSentences(dedupeParagraphs(stripSelfTalkParagraphs(text)));
  if (rewritten && rewritten !== text) {
    const rewrittenAnalysis = analyzeAssistantOutput(rewritten, policy);
    if (!policyExceeded(rewrittenAnalysis, policy)) {
      return {
        action: "rewrite",
        text: rewritten,
        reason: hasSelfTalk ? "Removed self-talk and duplicate output" : "Removed duplicate output",
        analysis: rewrittenAnalysis,
      };
    }
  }

  if (attempt < 1) {
    return {
      action: "retry",
      reason: hasSelfTalk ? "Output contains forbidden self-talk markers" : "Output exceeds repetition policy",
      analysis,
    };
  }

  return {
    action: "block",
    reason: hasSelfTalk ? "Repeated self-talk persists after retry" : "Repeated output persists after retry",
    analysis,
  };
}
