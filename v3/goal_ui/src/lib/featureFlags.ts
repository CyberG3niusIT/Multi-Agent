/**
 * Feature flags + environment accessors for goal_ui.
 *
 * All client-side Vite env vars are read here so consumer modules
 * stay decoupled from `import.meta.env` strings (cleaner mocks in
 * tests, easier audit during the security pass in Step 22a).
 *
 * Per ADR-093 §S1: this file deliberately does NOT read any
 * `LOVABLE_API_KEY`, `ANTHROPIC_API_KEY`, or `RUFLO_FUNCTIONS_TOKEN`.
 * Server-side keys never use the `VITE_` prefix and never reach the
 * browser. If you find yourself reaching for one here, you're
 * probably writing browser code that should instead call a
 * `LOCAL_FN` / `GCF` endpoint (Step 19).
 */

/** Truthy parser for `"1" | "true" | "yes" | "on"` (case-insensitive). */
function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '' ) return fallback;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function envString(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw;
}

/** Whether the IndexedDB-backed RVF browser backend is enabled. */
export const RVF_ENABLED: boolean = envBool(
  import.meta.env.VITE_RVF_ENABLED as string | undefined,
  /* default */ false,
);

/**
 * Whether `supabase.functions.invoke()` callsites should route to
 * the LOCAL_FN/GCF stack via `invokeFunction()` instead. Default
 * `false` keeps production behavior Supabase-backed; flipping it
 * routes all 4 wired workflows through the new functions stack
 * (Step 21a). Step 21b removes the Supabase path entirely and
 * deletes this flag.
 */
export const USE_LOCAL_FUNCTIONS: boolean = envBool(
  import.meta.env.VITE_USE_LOCAL_FUNCTIONS as string | undefined,
  /* default */ false,
);

/**
 * Base URL for server-side functions (LOCAL_FN in dev, GCF in prod).
 * Replaces Supabase Edge Function calls per ADR-093 Migration Matrix.
 */
export const FUNCTIONS_BASE_URL: string = envString(
  import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined,
  /* default */ 'http://localhost:8787',
);

/**
 * Weak abuse-control token for function calls. See ADR-093 §S2 — the
 * REAL defense is server-side rate-limit + CORS allowlist; this token
 * just filters random scanners.
 */
export const FUNCTIONS_PUBLIC_TOKEN: string = envString(
  import.meta.env.VITE_FUNCTIONS_PUBLIC_TOKEN as string | undefined,
  /* default */ 'dev-token-change-me',
);

/**
 * One-shot dump for debug surfaces. NEVER includes server-side keys
 * (those are never `VITE_*` so they're not visible here anyway).
 */
export function getFlagSnapshot() {
  return {
    RVF_ENABLED,
    FUNCTIONS_BASE_URL,
    // Don't echo the token even though it's not secret — keeps debug
    // panels from accidentally publishing it in screenshots.
    FUNCTIONS_PUBLIC_TOKEN_PRESENT: FUNCTIONS_PUBLIC_TOKEN.length > 0,
  } as const;
}
