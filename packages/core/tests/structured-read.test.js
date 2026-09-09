import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { buildReadOnlyTools, createAuthorizedToolExecutor, initializeOntologyRuntime } from "../dist/index.js";

describe("structured_read", () => {
  test("read-only tools expose structured_read", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-structured-read-tools-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const tools = buildReadOnlyTools(root, runtimePaths);
    assert.ok(tools.structured_read);
    assert.deepEqual(tools.structured_read.args, {
      path: {},
      mode: {},
      offset: {},
      length: {},
      pointer: {},
    });
  });

  test("authorizes reviewer and specialist, denies unbound and unknown agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-structured-read-auth-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const engine = runtime.getPolicyEngine();

    assert.equal(engine.authorize({
      agentId: "agent:reviewer:quality",
      toolName: "structured_read",
      toolId: "tool:structured_read",
      pattern: "README.md",
      runtimePaths,
    }).effect, "allow");

    assert.equal(engine.authorize({
      agentId: "agent:specialist:software-engineer",
      toolName: "structured_read",
      toolId: "tool:structured_read",
      pattern: "README.md",
      runtimePaths,
    }).effect, "allow");

    assert.equal(runtime.authorizeSession("missing", "structured_read", "README.md", runtimePaths).effect, "deny");
    assert.equal(engine.authorize({
      agentId: "agent:missing",
      toolName: "structured_read",
      toolId: "tool:structured_read",
      pattern: "README.md",
      runtimePaths,
    }).effect, "deny");
  });

  test("denies sensitive dotenv path for structured_read", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-structured-read-env-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const wrapped = createAuthorizedToolExecutor(
      buildReadOnlyTools(root, runtimePaths),
      { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
    );

    await writeFile(join(root, ".env"), "SECRET=1\n", "utf8");

    await assert.rejects(
      () => wrapped.structured_read.execute(
        { path: ".env", mode: "stat" },
        { sessionID: "s-sensitive", directory: root, agent: "reviewer:quality" },
      ),
      /Unauthorized tool execution for structured_read/,
    );
  });

  test("inspects giant one-line JSON with bounded output", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-structured-read-large-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const tools = buildReadOnlyTools(root, runtimePaths);
    const huge = {
      openapi: "3.1.0",
      info: { title: "Huge", version: "1.0.0" },
      paths: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`/route-${index}`, { get: { operationId: `getRoute${index}` } }])),
    };
    await writeFile(join(root, "huge.json"), JSON.stringify(huge), "utf8");

    const statResult = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "stat" }));
    assert.equal(statResult.metadata.mode, "stat");
    assert.equal(statResult.projection.authoritative, false);
    assert.equal(statResult.metadata.readonly, true);

    const keysResult = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "object_keys", pointer: "/paths" }));
    assert.equal(keysResult.result.total_keys, 400);
    assert.equal(keysResult.result.keys.length, 256);
    assert.equal(keysResult.metadata.truncated, true);

    const pointerResult = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "json_pointer", pointer: "/info" }));
    assert.equal(pointerResult.result.value_kind, "object");
    assert.match(pointerResult.result.text, /"title":"Huge"/);

    const prettyResult = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "pretty" }));
    assert.equal(prettyResult.metadata.truncated, true);
    assert.ok(prettyResult.result.text.length <= 16384);

    const byteSlice = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "slice_bytes", offset: 0, length: 16000 }));
    assert.equal(byteSlice.metadata.format, "base64");
    assert.equal(byteSlice.metadata.truncated, true);
    assert.ok(byteSlice.result.returned_bytes <= 8192);

    const charSlice = JSON.parse(await tools.structured_read.execute({ path: "huge.json", mode: "slice_chars", offset: 10, length: 16000 }));
    assert.equal(charSlice.metadata.format, "text");
    assert.equal(charSlice.metadata.truncated, true);
    assert.ok(charSlice.result.returned_chars <= 8192);
  });

  test("fails closed on malformed JSON for json_pointer object_keys pretty", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-structured-read-malformed-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const tools = buildReadOnlyTools(root, runtimePaths);
    await writeFile(join(root, "broken.json"), "{\"openapi\": true", "utf8");

    await assert.rejects(() => tools.structured_read.execute({ path: "broken.json", mode: "json_pointer", pointer: "/openapi" }), /requires valid JSON/);
    await assert.rejects(() => tools.structured_read.execute({ path: "broken.json", mode: "object_keys" }), /requires valid JSON/);
    await assert.rejects(() => tools.structured_read.execute({ path: "broken.json", mode: "pretty" }), /requires valid JSON/);
  });

  test("has no shell dependency", async () => {
    const source = await readFile(new URL("../src/tools/structured-read.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /child_process|spawn\(|exec\(|execa|shell/i);
  });
});
