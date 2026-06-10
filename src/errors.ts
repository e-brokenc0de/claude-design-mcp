/**
 * Loud, structured errors. We never swallow; we surface enough context for
 * a human to update selectors.ts when the UI shifts.
 */
export class DesignError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "DesignError";
    this.code = code;
    this.detail = detail;
  }
}

export const E = {
  notAuthed: (msg = "No authenticated session. Run `pnpm run auth:bootstrap`.") =>
    new DesignError("NOT_AUTHED", msg),
  selectorMissing: (which: string) =>
    new DesignError(
      "SELECTOR_MISSING",
      `Selector "${which}" did not match — UI likely changed. Update src/selectors.ts.`,
    ),
  unknownProject: (id: string) =>
    new DesignError("UNKNOWN_PROJECT", `No known project with id "${id}". Did you create_design_system first?`),
  notImplemented: (what: string) =>
    new DesignError("NOT_IMPLEMENTED", `${what} is not implemented yet (blocked on recon).`),
  reconRequired: (what: string) =>
    new DesignError("RECON_REQUIRED", `${what} requires recon evidence — fill in src/selectors.ts.`),
};
