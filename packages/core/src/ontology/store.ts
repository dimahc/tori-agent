/**
 * @file packages/core/src/ontology/store.ts
 * @description File-based persistence for the Ontology Registry (SC-05).
 */

import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OntologicalEntity, OntologyId } from '../types/ontology.js';
import { OntologyStore, FileSystemStoreConfig } from '../types/registry.js';
import { JSONLDSerializer } from '../serialization/jsonld.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default configuration for the file system store.
 */
export const DEFAULT_STORE_CONFIG: FileSystemStoreConfig = {
  baseDir: resolve(__dirname, '../../../../.opencode/ontology'),
  prettyPrint: true,
  extension: '.jsonld',
};

/**
 * File system implementation of the OntologyStore interface.
 * Stores entities as individual JSON-LD files in a directory structure.
 */
export class FileSystemOntologyStore implements OntologyStore {
  private config: FileSystemStoreConfig;
  private serializer: JSONLDSerializer;
  private staleFiles = new Set<string>();

  constructor(config: Partial<FileSystemStoreConfig> = {}) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
    this.serializer = new JSONLDSerializer();
  }

  /**
   * Initialize the serializer (loads JSON-LD context).
   */
  async initialize(): Promise<void> {
    await this.serializer.initialize();
    await this.ensureDirectory();
  }

  /**
   * Ensure the base directory exists.
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.baseDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create ontology directory: ${error}`);
    }
  }

  /**
   * Get the file path for an entity ID.
   */
  private getFilePath(id: OntologyId): string {
    // Sanitize ID for filesystem
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.config.baseDir, `${safeId}${this.config.extension}`);
  }

  async beginSave(): Promise<void> {
    await this.ensureDirectory();
    const files = await fs.readdir(this.config.baseDir);
    this.staleFiles = new Set(
      files
        .filter((file) => file.endsWith(this.config.extension))
        .map((file) => join(this.config.baseDir, file)),
    );
  }

  /**
   * Save all entities to the store.
   * Each entity is written as a separate JSON-LD file.
   */
  async save(entities: Map<OntologyId, OntologicalEntity>): Promise<void> {
    await this.ensureDirectory();

    const writePromises = Array.from(entities.entries()).map(async ([id, entity]) => {
      const filePath = this.getFilePath(id);
      this.staleFiles.delete(filePath);
      try {
        const jsonld = this.serializer.serialize(entity);
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, jsonld, 'utf-8');
        await fs.rename(tempPath, filePath);
      } catch (error) {
        throw new Error(`Failed to write entity ${id}: ${error}`);
      }
    });

    await Promise.all(writePromises);

    await Promise.all(
      Array.from(this.staleFiles).map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );
    this.staleFiles.clear();
  }

  /**
   * Load all entities from the store.
   * Reads all JSON-LD files in the base directory.
   */
  async load(): Promise<Map<OntologyId, OntologicalEntity>> {
    const entities = new Map<OntologyId, OntologicalEntity>();

    try {
      await this.ensureDirectory();
      const files = await fs.readdir(this.config.baseDir);

      const loadPromises = files
        .filter(f => f.endsWith(this.config.extension))
        .map(async (file) => {
          const filePath = join(this.config.baseDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Parse JSON-LD back to entity
            const entity = JSON.parse(content) as OntologicalEntity;
            if (entity['@id']) {
              entities.set(entity['@id'], entity);
            }
          } catch (error) {
            console.warn(`Failed to load entity from ${file}: ${error}`);
          }
        });

      await Promise.all(loadPromises);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to read ontology directory: ${error}`);
      }
      // Directory doesn't exist yet - return empty map
    }

    return entities;
  }

  /**
   * Create a backup of the current state.
   * Copies the entire ontology directory to a timestamped backup.
   */
  async backup(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.config.baseDir, `../.backups/ontology-${timestamp}`);

    try {
      await fs.mkdir(backupDir, { recursive: true });
      const files = await fs.readdir(this.config.baseDir);

      const copyPromises = files
        .filter(f => f.endsWith(this.config.extension))
        .map(async (file) => {
          const src = join(this.config.baseDir, file);
          const dest = join(backupDir, file);
          await fs.copyFile(src, dest);
        });

      await Promise.all(copyPromises);
    } catch (error) {
      throw new Error(`Failed to create backup: ${error}`);
    }
  }

  /**
   * Restore from the latest backup.
   * Finds the most recent backup directory and copies files back.
   */
  async restore(): Promise<void> {
    const backupRoot = join(this.config.baseDir, '../.backups');

    try {
      const entries = await fs.readdir(backupRoot);
      const backups = entries
        .filter(e => e.startsWith('ontology-'))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new Error('No backups found');
      }

      const latestBackup = join(backupRoot, backups[0]);
      const files = await fs.readdir(latestBackup);

      await this.ensureDirectory();

      const copyPromises = files
        .filter(f => f.endsWith(this.config.extension))
        .map(async (file) => {
          const src = join(latestBackup, file);
          const dest = join(this.config.baseDir, file);
          await fs.copyFile(src, dest);
        });

      await Promise.all(copyPromises);
    } catch (error) {
      throw new Error(`Failed to restore from backup: ${error}`);
    }
  }

  /**
   * Check if the store exists (has any entity files).
   */
  async exists(): Promise<boolean> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      return files.some(f => f.endsWith(this.config.extension));
    } catch {
      return false;
    }
  }

  /**
   * Get the store configuration.
   */
  getConfig(): FileSystemStoreConfig {
    return { ...this.config };
  }

  /**
   * Delete an entity file.
   */
  async delete(id: OntologyId): Promise<boolean> {
    const filePath = this.getFilePath(id);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw new Error(`Failed to delete entity ${id}: ${error}`);
    }
  }

  /**
   * List all entity IDs in the store.
   */
  async listIds(): Promise<OntologyId[]> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      return files
        .filter(f => f.endsWith(this.config.extension))
        .map(f => f.slice(0, -this.config.extension.length));
    } catch {
      return [];
    }
  }
}
