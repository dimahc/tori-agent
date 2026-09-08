import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JSONLDSerializer } from "../serialization/jsonld.js";
import type { OntologyStore, FileSystemStoreConfig } from "../types/registry.js";
import type { OntologyEntity, OntologyId } from "@tori-agent/ontology";

export const DEFAULT_STORE_CONFIG: FileSystemStoreConfig = {
  baseDir: ".opencode/ontology",
  prettyPrint: true,
  extension: ".jsonld",
};

function safeFileName(id: OntologyId): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileSystemOntologyStore implements OntologyStore {
  private readonly config: FileSystemStoreConfig;
  private readonly serializer = new JSONLDSerializer();

  constructor(config: Partial<FileSystemStoreConfig> = {}) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    await this.serializer.initialize();
    await mkdir(this.config.baseDir, { recursive: true });
  }

  async beginSave(): Promise<void> {
    await this.initialize();
  }

  async save(entities: Map<OntologyId, OntologyEntity>): Promise<void> {
    await this.initialize();

    const existing = await this.listEntityFiles();
    const expected = new Set<string>();

    await Promise.all(
      Array.from(entities.entries()).map(async ([id, entity]) => {
        const fileName = `${safeFileName(id)}${this.config.extension}`;
        expected.add(fileName);
        await writeFile(join(this.config.baseDir, fileName), this.serializer.serialize(entity), "utf8");
      }),
    );

    await Promise.all(
      existing
        .filter((file) => !expected.has(file))
        .map((file) => rm(join(this.config.baseDir, file), { force: true })),
    );
  }

  async load(): Promise<Map<OntologyId, OntologyEntity>> {
    await this.initialize();
    const entities = new Map<OntologyId, OntologyEntity>();
    for (const file of await this.listEntityFiles()) {
      const parsed = JSON.parse(await readFile(join(this.config.baseDir, file), "utf8")) as OntologyEntity;
      entities.set(parsed["@id"], parsed);
    }
    return entities;
  }

  async backup(): Promise<void> {
    throw new Error("Backup removed from strict ontology runtime. Use VCS or copy runtime root explicitly.");
  }

  async restore(): Promise<void> {
    throw new Error("Restore removed from strict ontology runtime. Rebuild ontology from canonical specs.");
  }

  async exists(): Promise<boolean> {
    return (await this.listEntityFiles()).length > 0;
  }

  async listIds(): Promise<OntologyId[]> {
    const loaded = await this.load();
    return Array.from(loaded.keys());
  }

  async delete(id: OntologyId): Promise<boolean> {
    await rm(join(this.config.baseDir, `${safeFileName(id)}${this.config.extension}`), { force: true });
    return true;
  }

  getConfig(): FileSystemStoreConfig {
    return { ...this.config };
  }

  private async listEntityFiles(): Promise<string[]> {
    await mkdir(this.config.baseDir, { recursive: true });
    return (await readdir(this.config.baseDir)).filter((file) => file.endsWith(this.config.extension));
  }
}

export class NoopOntologyStore implements OntologyStore {
  async save(): Promise<void> {
    // strict runtime bootstrap never persists builtin or merged ontology into project directories
  }

  async load(): Promise<Map<OntologyId, OntologyEntity>> {
    return new Map();
  }

  async backup(): Promise<void> {
    throw new Error("Backup unsupported for noop ontology store.");
  }

  async restore(): Promise<void> {
    throw new Error("Restore unsupported for noop ontology store.");
  }

  async exists(): Promise<boolean> {
    return false;
  }
}
