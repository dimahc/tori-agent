import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAssistantOutput,
  governAssistantOutputText,
  sanitizeAssistantOutputText,
} from "../dist/index.js";

describe("output guardrails", () => {
  test("sanitize fast path preserves clean text and reports unchanged", () => {
    const text = "Implementation complete. Verification passed.";
    const result = sanitizeAssistantOutputText(text, {
      max_repeated_paragraphs: 1,
      max_repeated_sentences: 1,
      max_self_talk_markers: 0,
    });
    assert.equal(result.text, text);
    assert.equal(result.changed, false);
    assert.deepEqual(result.analysis, analyzeAssistantOutput(text, {
      max_repeated_paragraphs: 1,
      max_repeated_sentences: 1,
      max_self_talk_markers: 0,
    }));
  });

  test("sanitize rewrites duplicate self-talk deterministically", () => {
    const text = "Let me think through this.\n\nResult ready.\n\nResult ready.";
    const result = sanitizeAssistantOutputText(text, {
      max_repeated_paragraphs: 1,
      max_repeated_sentences: 1,
      max_self_talk_markers: 0,
    });
    assert.equal(result.text, "Result ready.");
    assert.equal(result.changed, true);
    assert.equal(result.reason, "Removed self-talk and duplicate output");
  });

  test("govern returns allow for clean text and rewrite for repeated text", () => {
    const policy = {
      max_repeated_paragraphs: 1,
      max_repeated_sentences: 1,
      max_self_talk_markers: 0,
    };
    const allowed = governAssistantOutputText("Done. Verified.", policy);
    assert.equal(allowed.action, "allow");
    const rewritten = governAssistantOutputText("Done. Done.", policy);
    assert.equal(rewritten.action, "rewrite");
    assert.equal(rewritten.text, "Done.");
  });
});
