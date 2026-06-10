/**
 * CENTRALIZED selectors + endpoint patterns for Claude Design.
 *
 * RULE: every CSS/XPath/URL pattern referenced by any backend lives here.
 * When the UI shifts, this is the only file that should change.
 *
 * All values are PLACEHOLDERS until M0 recon fills them with evidence captured
 * from the live app. Each entry includes the user-visible label / network hint
 * so a future reader can re-find it manually.
 */

// ---------- URLs ----------
export const urls = {
  base: "https://claude.ai/design",
  // Filled in recon: pattern like https://claude.ai/design/p/<projectId> ?
  projectById: (id: string) => `https://claude.ai/design/p/${id}`,
};

// ---------- Page selectors (DOM) ----------
// Strings here MUST be replaced from recon. Marked PENDING_RECON.
export const selectors = {
  // Landing / new-project flow
  newProjectNameInput: 'input[placeholder*="Name" i]', // PENDING_RECON
  newProjectBriefTextarea: 'textarea[placeholder*="brief" i], textarea[placeholder*="describe" i]', // PENDING_RECON
  createProjectButton: 'button:has-text("Create")', // PENDING_RECON
  generateButton: 'button:has-text("Generate")', // PENDING_RECON

  // Chat / iteration
  chatInput: 'div[contenteditable="true"], textarea[placeholder*="message" i]', // PENDING_RECON
  sendButton: 'button[aria-label*="send" i]', // PENDING_RECON
  verifierIndicator: 'text=/Checking the design for issues/i', // PENDING_RECON

  // Files panel
  filesTabButton: 'button:has-text("Files")', // PENDING_RECON
  fileTreeItem: '[role="treeitem"]', // PENDING_RECON
  fileContentPane: '[data-testid="file-content"], pre', // PENDING_RECON

  // Status detection
  generatingIndicator: 'text=/Generating/i', // PENDING_RECON
  readyIndicator: 'text=/Ready|Done|Preview/i', // PENDING_RECON
  errorIndicator: '[role="alert"]', // PENDING_RECON
} as const;

// ---------- Network hints (for API backend, filled by recon) ----------
// These are documentation-only stubs the recon scripts will overwrite.
export const apiHints = {
  // e.g. POST /api/organizations/:org/design_projects
  createProject: "PENDING_RECON",
  startGeneration: "PENDING_RECON",
  projectStatus: "PENDING_RECON",
  listFiles: "PENDING_RECON",
  readFile: "PENDING_RECON",
  sendChatMessage: "PENDING_RECON",
} as const;
