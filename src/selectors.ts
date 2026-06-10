/**
 * CENTRALIZED endpoints + selectors for Claude Design.
 *
 * RULE: every RPC path, URL pattern, and CSS selector lives here. When the
 * service or UI shifts, this is the only file that should change.
 *
 * Backed by M0 recon (see RECON.md): the app is a Connect-RPC service
 * "OmeletteService" that also speaks application/json.
 */

export const urls = {
  base: "https://claude.ai/design",
  projectById: (id: string) => `https://claude.ai/design/p/${id}`,
};

/** Connect-RPC service base path (same-origin under /design). */
export const rpc = {
  service: "anthropic.omelette.api.v1alpha.OmeletteService",
  basePath: "/design/anthropic.omelette.api.v1alpha.OmeletteService",
  origin: "https://claude.ai",
  url(method: string): string {
    return `${this.origin}${this.basePath}/${method}`;
  },
} as const;

/** RPC method names (verified in recon). */
export const methods = {
  getMe: "GetMe",
  getUsageStatus: "GetUsageStatus",
  listProjects: "ListProjects",
  listOrgProjects: "ListOrgProjects",
  createProject: "CreateProject",
  getProject: "GetProject",
  updateProject: "UpdateProject",
  deleteProject: "DeleteProject",
  duplicateProject: "DuplicateProject",
  remixProject: "RemixProject",
  setProjectFavorite: "SetProjectFavorite",
  getChatMessages: "GetChatMessages",
  getProjectData: "GetProjectData",
  updateProjectData: "UpdateProjectData",
  updateProjectDesignSystems: "UpdateProjectDesignSystems",
  refreshBoundDesignSystem: "RefreshBoundDesignSystem",
  listFiles: "ListFiles",
  getFile: "GetFile",
  writeFiles: "WriteFiles",
  editFile: "EditFile",
  deleteFile: "DeleteFile",
  grepFiles: "GrepFiles",
  setProjectPublished: "SetProjectPublished",
  getOrgSettings: "GetOrgSettings",
  updateOrgSettings: "UpdateOrgSettings",
  createClaudeCodeSession: "CreateClaudeCodeSession",
} as const;

/** ProjectType enum values. */
export const projectType = {
  designSystem: "PROJECT_TYPE_DESIGN_SYSTEM",
  project: "PROJECT_TYPE_PROJECT",
  template: "PROJECT_TYPE_TEMPLATE",
} as const;

/**
 * DOM selectors for the chat flow (generate/iterate go through the UI because
 * the Chat RPC carries an opaque `messages_request` bytes payload).
 * PENDING: confirm against a live project page.
 */
export const selectors = {
  chatInput: 'div.ProseMirror[contenteditable="true"]', // verified
  sendButton: 'button:has-text("Send")', // verified; disabled while a turn is active
  verifierText: /checking the design|reviewing|verifying/i, // body-text signal
} as const;
