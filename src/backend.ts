/**
 * Backend abstraction. The MCP tool layer calls only this interface.
 * Two implementations:
 *   - PlaywrightBackend: drives the UI using a persistent auth profile.
 *   - ApiBackend (future): hits the captured internal HTTP/WebSocket API directly.
 *
 * Recon (M0) decides which backend a given tool prefers. The interface
 * is identical so we can swap per-tool when the API path is mapped.
 */

export type ProjectStatus = "generating" | "ready" | "error" | "draft";

export interface ProjectRef {
  projectId: string;
  url: string;
  name: string;
  /** The brief, stashed at create time and sent on first generate. */
  brief?: string;
  /** The active chat id once generation has begun (for status/iterate). */
  chatId?: string;
}

export interface FileEntry {
  path: string;
  size?: number;
  kind?: "css" | "ts" | "tsx" | "md" | "json" | "other";
}

export interface CreateInput {
  name: string;
  brief: string;
  sources?: string[]; // optional reference URLs / inspiration
}

export interface DesignBackend {
  /** Lifecycle */
  init(): Promise<void>;
  shutdown(): Promise<void>;

  /** Tool surface — 1:1 with MCP tools */
  createDesignSystem(input: CreateInput): Promise<ProjectRef>;
  generate(projectId: string): Promise<void>;
  getStatus(projectId: string): Promise<{ status: ProjectStatus; detail?: string }>;
  iterate(projectId: string, prompt: string): Promise<void>;
  listFiles(projectId: string): Promise<FileEntry[]>;
  /** Decoded text contents (utf8). For binary files prefer readFileRaw. */
  readFile(projectId: string, filePath: string): Promise<string>;
  /** Raw bytes + content type — used by export to write files faithfully. */
  readFileRaw(projectId: string, filePath: string): Promise<{ data: Buffer; contentType?: string }>;
  publish(projectId: string): Promise<void>;
  setDefault(projectId: string): Promise<void>;
  listDesignSystems(): Promise<ProjectRef[]>;
}
