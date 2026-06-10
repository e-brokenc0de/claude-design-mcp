/**
 * Backend abstraction. The MCP tool layer calls only this interface.
 * Implemented by CdpBackend (real Chrome over CDP + Omelette Connect-JSON RPC,
 * with chat actions driven through the DOM).
 */

export type ProjectStatus = "generating" | "ready" | "error" | "draft";
export type ProjectKind = "design_system" | "project";

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

export interface CreateProjectInput {
  name: string;
  brief?: string;
  /** Design system project ids to bind to this project. */
  designSystemIds?: string[];
  /** Enable design-component reuse from the bound systems. */
  designComponents?: boolean;
}

export interface DesignSystemBinding {
  dsProjectId: string;
  name?: string;
  syncedAtVersion?: string;
  hasV2Layout?: boolean;
}

export interface Conversation {
  chatId: string;
  title: string;
  turns: number;
  lastOpened?: string;
  active?: boolean;
}

export interface GrepMatch {
  path: string;
  line: number;
  context: string[];
}

export interface UsageStatus {
  fiveHour?: unknown;
  sevenDay?: unknown;
  extraUsage?: unknown;
}

export interface DesignBackend {
  /** Lifecycle */
  init(): Promise<void>;
  shutdown(): Promise<void>;

  // --- create / generate / iterate ---
  createDesignSystem(input: CreateInput): Promise<ProjectRef>;
  createDesignProject(input: CreateProjectInput): Promise<ProjectRef>;
  generate(projectId: string): Promise<void>;
  getStatus(projectId: string): Promise<{ status: ProjectStatus; detail?: string }>;
  iterate(projectId: string, prompt: string): Promise<void>;
  /** Send a prompt/revision; optionally target a specific conversation. */
  sendMessageTool(projectId: string, prompt: string, conversationId?: string): Promise<void>;

  // --- conversations ---
  listConversations(projectId: string): Promise<Conversation[]>;
  /** Start a fresh conversation; returns its chatId. */
  newConversation(projectId: string): Promise<string>;

  // --- design system bindings ---
  attachDesignSystem(projectId: string, designSystemId: string): Promise<DesignSystemBinding[]>;
  detachDesignSystem(projectId: string, designSystemId: string): Promise<DesignSystemBinding[]>;
  listAttachedDesignSystems(projectId: string): Promise<DesignSystemBinding[]>;
  refreshDesignSystem(projectId: string, designSystemId?: string): Promise<void>;

  // --- files ---
  listFiles(projectId: string): Promise<FileEntry[]>;
  readFile(projectId: string, filePath: string): Promise<string>;
  readFileRaw(projectId: string, filePath: string): Promise<{ data: Buffer; contentType?: string }>;
  /** Export all files plus a handoff bundle (README/PROMPT + chat transcripts). DEPRECATED: prefer mintHandoff. */
  exportHandoff(projectId: string, destDir: string): Promise<{ files: number; chats: number; dir: string }>;
  /**
   * Official Claude Code handoff: mint a capability URL to the server-built bundle
   * (tar.gz). Returns the URL + ready-to-run command. If destDir is given, also
   * downloads + extracts the bundle locally and returns the extracted project dir.
   */
  mintHandoff(
    projectId: string,
    opts?: { includeChats?: boolean; instructions?: string; destDir?: string },
  ): Promise<{
    url: string;
    command: string;
    expiresAt?: string;
    dir?: string;
    projectDir?: string;
    files?: number;
  }>;
  searchFiles(projectId: string, pattern: string): Promise<GrepMatch[]>;
  writeFile(projectId: string, filePath: string, content: string): Promise<void>;
  editFile(projectId: string, filePath: string, oldString: string, newString: string): Promise<number>;
  deleteFile(projectId: string, filePath: string): Promise<void>;

  // --- publish / default / listing ---
  publish(projectId: string): Promise<void>;
  setDefault(projectId: string): Promise<void>;
  listDesignSystems(): Promise<ProjectRef[]>;
  listProjects(): Promise<(ProjectRef & { kind: ProjectKind })[]>;

  // --- management / handoff ---
  renameProject(projectId: string, name: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  duplicateProject(projectId: string): Promise<ProjectRef>;
  remixProject(projectId: string, includeChats?: boolean): Promise<ProjectRef>;
  setFavorite(projectId: string, favorite: boolean): Promise<void>;
  getUsage(): Promise<UsageStatus>;
  createClaudeCodeSession(projectId: string, instructions?: string): Promise<{ sessionId?: string; sessionUrl?: string; resumed?: boolean }>;
}
