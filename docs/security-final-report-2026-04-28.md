# RuFlo Security Assessment — Final Consolidated Report

**Date:** 2026-04-28
**Assessed Version:** ruflo v3.5 / claude-flow v3.6.5 (commit f9f0e5bce)
**Assessment Method:** 3-agent security fleet + adversarial review
**Reports Generated:**
- `security-audit-plugins-2026-04-28.md` — Plugin system deep dive
- `security-scan-qe-fleet-2026-04-28.md` — Full monorepo SAST (2,414 files)
- `security-devils-advocate-2026-04-28.md` — Adversarial challenge review

---

## Executive Summary

The RuFlo/Claude Flow project has a **well-designed V3 security module** (`@claude-flow/security`) with `SafeExecutor`, `PathValidator`, `InputValidator`, and `safeJsonParse`. However, this module is **under-adopted** within V3 itself — the inter-agent trust model has fundamental gaps and the plugin system lacks sandboxing.

**V2 code is excluded from this priority plan.** The published `claude-flow@3.6.5` package only ships V3 code (confirmed via `package.json` `files` array). V2 is legacy code remaining in the repository but not delivered to npm users. V2 findings (SEC-001 through SEC-013) are documented in the fleet scan report for reference but are not actionable priorities.

After deduplication, false-positive correction, and V2 exclusion, the adjusted finding count is:

| Severity | Raw Count | After V2 Exclusion + Correction | Actionable |
|----------|-----------|--------------------------------|------------|
| CRITICAL | 11 | **2** | 2 |
| HIGH | 22 | **9** | 9 |
| MEDIUM | 28 | **12** | 10 |
| LOW | 19 | 8 | Opportunistic |

**Corrected overall risk (V3 only): 5.0/10 (Medium)**

The 2 confirmed CRITICALs in shipped code:
1. Registry signature verification is a no-op (CRIT-01)
2. No plugin sandboxing — full process access (CRIT-02)

---

## Prioritized Fix Plan

### Sprint 0: Immediate (1-2 days, effort: Low)

These have straightforward fixes that eliminate the highest-risk attack vectors in shipped V3 code.

| # | Finding | Fix | Effort | Impact |
|---|---------|-----|--------|--------|
| 1 | **CRIT-01**: Registry signature verification stub | Implement real Ed25519 verification using existing `verifyEd25519Signature`; block registry use on failure | 4 hours | Closes entire plugin supply chain attack |
| 2 | **CRIT-04**: Demo registry fallback returns `success: true` | Return `success: false` or add `isDemoMode: true` flag; block `plugins install` in demo mode | 1 hour | Prevents installation from unverified source |
| 3 | **BS-01** (new): SSRF via embeddings `baseURL` | Add URL allowlist validation — only permit known API hosts + localhost; strip credentials from non-allowlisted URLs | 2 hours | Closes credential exfiltration via SSRF |
| 4 | **HIGH-07/#1608**: 6 HIGH CVEs via tar | Add `"overrides": { "tar": ">=7.5.11" }` to `@claude-flow/security/package.json` | 30 min | Resolves 6 known CVEs |
| 5 | **HIGH-08/#1609**: Vulnerable vitest devDeps | Bump `vitest` to `^4.1.4` across all 12 affected packages | 1 hour | Resolves 4 moderate CVEs |

**Estimated Sprint 0 total: 1-2 days**

---

### Sprint 1: High Priority (1 week, effort: Medium)

These close systemic vulnerability classes in shipped V3 code.

| # | Finding | Fix | Effort | Impact |
|---|---------|-----|--------|--------|
| 6 | **HIGH-02**: Prototype pollution in `JSON.parse` and `mergeDeep` (V3 files) | Adopt `safeJsonParse` from security module in all V3 plugins; add `__proto__`/`constructor` filter to V3 merge functions (`shared/src/core/config/loader.ts`, `cli/src/mcp-tools/hooks-tools.ts`); add ESLint rule | 1 day | Closes prototype pollution class |
| 7 | **SEC-016**: V3 MCP WebSocket auth disabled by default | Flip default to `isAuthenticated: false` (require explicit auth); bind to `127.0.0.1` by default | 4 hours | Closes unauthorized tool execution |
| 8 | **BS-02/BS-03/AC-01**: Agent memory — no identity enforcement + prompt injection via retrieval | Add mandatory `ownerId` scoping; integrate aidefence scanning on memory retrieval before LLM context injection | 2-3 days | Closes memory poisoning → privilege escalation chain |
| 9 | **HIGH-05**: Environment variable mutation from plugin code | Sandbox `process.env` access; reject `=` and shell metacharacters in `sanitizeEnvValue`; block `PATH`/`NODE_OPTIONS` mutation | 2 hours | Prevents env-based hijacking |
| 10 | **HIGH-06**: Dependency confusion — npm install proceeds for unknown plugins | Only allow installation of plugins matching verified registry entries; warn on unrecognized names | 4 hours | Prevents typosquatting |
| 11 | **BS-07**: HNSW/SQLite resource exhaustion | Enforce `maxElements` cap; add `max_page_count` PRAGMA; schedule periodic `wal_checkpoint` | 1 day | Prevents DoS via resource exhaustion |

**Estimated Sprint 1 total: 5-6 days**

---

### Sprint 2: Structural Improvements (2-3 weeks, effort: High)

These require design decisions and potentially breaking changes but close fundamental architecture gaps.

| # | Finding | Fix | Effort | Impact |
|---|---------|-----|--------|--------|
| 12 | **CRIT-02**: No plugin sandboxing | Phase 1: Enforce permission check — compare plugin's declared permissions against `allowedPermissions` before loading; prompt user for `credentials`/`execute`/`privileged`. Phase 2: Evaluate `isolated-vm` or Node.js worker threads for actual isolation. | 3-5 days | Prevents malicious plugin takeover |
| 13 | **CG-01**: Hooks system security review | Audit `v3/@claude-flow/hooks/src/` (26 files) — particularly LLM hooks that intercept/modify prompts and responses | 2-3 days (audit) | Identifies any hooks-based attack vectors |
| 14 | **BS-08**: V3 MCP WebSocket `maxConnections` has no default | Set a sensible default (e.g., 50); enforce even when config omits the field | 2 hours | Prevents connection exhaustion DoS |
| 15 | **BS-06**: DNS rebinding on localhost servers | Validate `Host` header against expected values on all V3 HTTP/WebSocket transports | 4 hours | Closes DNS rebinding vector |
| 16 | **BS-04**: WASM kernel `JSON.parse` without proto guards | Use `safeJsonParse` in JS fallback; validate input size at WASM bridge boundary | 2 hours | Hardens governance layer |
| 17 | **MED-06**: IPFS cache poisoning | Validate registry integrity on cached entries; reduce TTL or add invalidation on verification failure | 4 hours | Prevents stale poisoned cache |

**Estimated Sprint 2 total: 2-3 weeks**

---

### Sprint 3: Hardening and Depth (1-2 months, effort: High)

These are important but require significant engineering investment or are lower-probability attack vectors.

| # | Finding | Fix | Effort | Impact |
|---|---------|-----|--------|--------|
| 18 | **CG-02**: WASM kernel audit | Audit Rust source (or binary analysis) of `guidance_kernel_bg.wasm` for memory safety; validate all inputs at the JS/WASM bridge boundary | 1-2 weeks | Verifies governance layer integrity |
| 19 | **HIGH-04**: Plugin code signing | Implement Ed25519 signing for published plugins; verify signatures before loading; TOFU model for community plugins | 1-2 weeks | Full supply chain integrity |
| 20 | **Issue #640**: Agent verification pipeline | Implement mandatory test execution after agent claims; truth scoring between claimed and actual results; automated rollback on verification failure | 2-4 weeks | Eliminates compound deception cascade |
| 21 | **CG-04**: Neural learning integrity | Add validation/signing to stored patterns; rate-limit pattern storage; implement adversarial detection for training data | 1-2 weeks | Prevents persistent behavioral manipulation |
| 22 | **Browser eval** (H-3): Strengthen blocklist | Normalize Unicode before pattern matching; add `Proxy`, `WebAssembly`, `fetch`, `document.cookie` to blocklist; consider CSP-based approach | 2-3 days | Reduces browser eval bypass surface |
| 23 | **AE-03**: Make CI checks blocking | Change `npm audit || true` to `npm audit --audit-level=high` (fail on high+); remove `|| echo "non-blocking"` from CI workflows | 1 hour | Prevents silent CVE introduction |

**Estimated Sprint 3 total: 5-7 weeks**

---

### Backlog: Low Priority / Opportunistic

| Finding | Fix | Notes |
|---------|-----|-------|
| BS-05: ReDoS in error handler | Pre-compile regexes; add timeout | Unlikely in practice |
| BS-10: 20 ruflo-level plugins unaudited | Security review of `/plugins/ruflo-*` | Low urgency |
| CG-06: aidefence bypass testing | Test whether detection patterns are comprehensive | Low urgency |
| L-1 through L-5: Plugin manifest perms, verbose errors, etc. | Standard hardening | Opportunistic |

---

## V2 Code — Excluded from Priority Plan

V2 code is **not shipped** in the published `claude-flow@3.6.5` package (`package.json` `files` array only includes `v3/` paths). V2 remains in the repository as legacy code from the previous major version.

The QE fleet scan found 13 findings in V2 code (SEC-001 through SEC-013). These are documented in `security-scan-qe-fleet-2026-04-28.md` for reference but are **not actionable priorities** for the current release.

**Recommended V2 actions (non-blocking):**
- Add a `v2/DEPRECATED.md` noting V2 is unmaintained legacy
- Consider removing V2 from the repository entirely in a future cleanup
- If V2 code is ever reactivated, the fleet scan findings become relevant

---

## Open GitHub Issues — Recommended Actions

| Issue | Action | Priority |
|-------|--------|----------|
| #1608 (tar CVEs) | Apply override in Sprint 1 | P1 |
| #1609 (vitest CVEs) | Bump in Sprint 1 | P1 |
| #640 (verification system) | Sprint 3 implementation | P3 |
| #724 (MCP input validation) | Include in Sprint 1 auth hardening | P1 |
| #261 (WASM transparency) | Sprint 3 WASM audit | P3 |
| #1482 (independent review) | Most findings addressed by this plan; close with reference | P2 |
| #1261 (preinstall script) | Already removed; close with explanation that it was migration cleanup | Close |

---

## Effort Summary (V3 Only)

| Sprint | Duration | Findings Closed | Risk Reduction |
|--------|----------|-----------------|----------------|
| Sprint 0 | 1-2 days | 5 (2 CRIT, 2 HIGH, 1 new blind spot) | -2.0 risk points |
| Sprint 1 | 1 week | 6 (4 HIGH, 1 attack chain, 1 MEDIUM) | -1.5 risk points |
| Sprint 2 | 2-3 weeks | 6 (1 CRIT, 3 HIGH, 2 MEDIUM) | -1.0 risk points |
| Sprint 3 | 5-7 weeks | 6 (2 HIGH, 4 MEDIUM) | -0.5 risk points |
| **Total** | **~2.5 months** | **23 findings** | **5.0 → ~1.0** |

After Sprint 0 + Sprint 1 (~8 days total), both CRITICALs are resolved, the top attack chain is closed, and risk drops from 5.0 to ~1.5.

---

## Summary

The V3 shipped code has **2 CRITICALs** (registry signature stub + no plugin sandboxing), **9 HIGHs** (prototype pollution, SSRF, auth defaults, memory trust, resource exhaustion), and a novel attack chain (memory poisoning → privilege escalation).

Fix order:
1. **Days 1-2**: Fix registry signing + demo fallback + embeddings SSRF + dependency CVEs
2. **Week 1**: Close prototype pollution class, auth defaults, memory trust model, env mutation
3. **Weeks 2-4**: Plugin sandboxing, hooks audit, DNS rebinding, connection limits
4. **Months 2-3**: WASM audit, plugin code signing, agent verification, neural integrity

The security module (`@claude-flow/security`) is well-built — the priority is wiring it into the 5-6 V3 code paths that currently bypass it.

---

*Generated from 3-agent security assessment + adversarial review. Sources: plugin audit, QE fleet SAST, devil's advocate challenge. V2 findings excluded (legacy, not shipped).*
