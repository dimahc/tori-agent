import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveryTools,
  getAllLazyTools,
  getLazyTool,
  registerLazyTool,
} from "../dist/plugin/index.js";

describe("lazy tool registry", () => {
  test("registers and lists tools", async () => {
    registerLazyTool({
      name: "custom_tool",
      category: "core",
      description: "desc",
      args: {},
      execute: async () => "ok",
    });
    assert.ok(getLazyTool("custom_tool"));
    assert.ok(getAllLazyTools().some((tool) => tool.name === "custom_tool"));
    const result = JSON.parse(await buildDiscoveryTools().list_available_tools.execute({}));
    assert.ok(result.tools.some((tool) => tool.name === "custom_tool"));
  });
});
