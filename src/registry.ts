import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectRef } from "./backend.js";

/**
 * Persists projectId -> { url, name } across stdio invocations so callers can
 * generate() / get_status() / iterate() on the same project later.
 * Pages themselves are held in-memory by the backend (see PlaywrightBackend).
 */
export class ProjectRegistry {
  private file: string;
  private cache = new Map<string, ProjectRef>();

  constructor(stateDir: string) {
    this.file = path.join(stateDir, "projects.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const arr = JSON.parse(raw) as ProjectRef[];
      this.cache = new Map(arr.map((p) => [p.projectId, p]));
    } catch {
      this.cache = new Map();
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const arr = [...this.cache.values()];
    await fs.writeFile(this.file, JSON.stringify(arr, null, 2));
  }

  upsert(p: ProjectRef): void {
    this.cache.set(p.projectId, p);
  }

  get(id: string): ProjectRef | undefined {
    return this.cache.get(id);
  }

  list(): ProjectRef[] {
    return [...this.cache.values()];
  }
}
