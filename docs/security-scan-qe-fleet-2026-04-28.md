# RuFlo / Claude Flow v3.5 -- QE Fleet Security Scan Report

**Date:** 2026-04-28  
**Scanner:** V3 QE Security Scanner (Opus 4.6)  
**Scope:** Full monorepo -- 2,414 source files, 65+ packages  
**Branch:** qe-working-branch (commit f9f0e5bce)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Overall Risk Score | **7.2 / 10 (High)** |
| Critical Findings | 4 |
| High Findings | 9 |
| Medium Findings | 12 |
| Low Findings | 8 |
| Info Findings | 5 |
| Total Findings | **38** |
| Files Scanned | 2,414 |
| Packages Analyzed | 65 |
| Secrets Detected | 1 confirmed, 0 live keys |

The RuFlo codebase has a well-designed V3 security layer (`@claude-flow/security`) with `SafeExecutor`, `PathValidator`, `InputValidator`, and `safeJsonParse`. However, the **V2 codebase and several V3 entry points bypass these protections entirely**. The primary risks are: (1) command injection through unsanitized string interpolation into `execSync`, (2) SQL injection in `ATTACH DATABASE` and template-literal SQL, (3) prototype pollution in multiple `mergeDeep` implementations, (4) a committed `.env` file in git history, and (5) wildcard CORS on WebSocket and HTTP servers with no authentication.

---

## Findings by Severity

### CRITICAL

#### SEC-001: Command Injection via `execSync` with String Interpolation

| Field | Value |
|-------|-------|
| ID | SEC-001 |
| Severity | CRITICAL |
| CVSS | 9.8 |
| CWE | CWE-78 (OS Command Injection) |
| OWASP | A03:2021 Injection |

**Description:** Multiple files construct shell commands by interpolating untrusted parameters directly into `execSync()` calls. An attacker who controls `params.description`, `params.message`, `params.file`, or `resultJson` can escape the double-quoted string and execute arbitrary OS commands.

**Affected Files:**

| File | Lines | Vector |
|------|-------|--------|
| `v2/bin/automation-executor.js` | 1377-1395 | `params.description`, `params.message`, `params.file` interpolated into `execSync(hookCommand)` |
| `v2/bin/automation-executor.js` | 1411 | `resultJson` (from `JSON.stringify(result)`) interpolated into shell via single-quoted string -- breakable with `'` in result values |
| `v2/bin/init/templates/github-safe.js` | 80-105 | `args.join(' ')` passed to `execSync(\`gh ${args.join(' ')}\`)` with user-controlled args |
| `v2/bin/swarm.js` | 1146 | `commandArgs` from user `objective` and `flags` interpolated into `execSync()` |
| `v2/bin/github/gh-coordinator.js` | 124-145 | Multiple `execSync` calls with string interpolation |

**Proof of Concept:**

```javascript
// v2/bin/automation-executor.js:1379-1395
let hookCommand = `npx claude-flow@alpha hooks ${hookType}`;
if (params.description) {
  hookCommand += ` --description "${params.description}"`;
  // If params.description = '"; rm -rf / #', command becomes:
  // npx claude-flow@alpha hooks pre-task --description ""; rm -rf / #"
}
execSync(hookCommand, { stdio: 'pipe' });
```

**Remediation:**
1. Replace all `execSync(interpolatedString)` with `execFileSync(command, argsArray)` (no shell).
2. Use the existing `SafeExecutor` from `@claude-flow/security` which already prevents this.
3. Validate all parameters through `CommandArgumentSchema` before use.

---

#### SEC-002: SQL Injection via `ATTACH DATABASE` with Template Literals

| Field | Value |
|-------|-------|
| ID | SEC-002 |
| Severity | CRITICAL |
| CVSS | 9.1 |
| CWE | CWE-89 (SQL Injection) |
| OWASP | A03:2021 Injection |

**Description:** `ATTACH DATABASE` commands are built via template literal string interpolation using values derived from filesystem paths. If an attacker can control or influence database filenames (e.g., through a crafted directory name), they can inject SQL.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/bin/memory-consolidation.js` | 354 |
| `v2/bin/memory-consolidation.js` | 373 |
| `v2/bin/memory-consolidation.js` | 381 |
| `v2/src/cli/simple-commands/memory-consolidation.js` | 354, 373, 381 |

**Vulnerable Code:**

```javascript
// v2/bin/memory-consolidation.js:354
const alias = `db_${path.basename(dbFile, '.db')}`;
await db.exec(`ATTACH DATABASE '${dbFile}' AS ${alias}`);

// Line 373 -- table name from dynamic source injected unquoted:
// FROM ${alias}.${table.name}

// Line 372 -- dbFile injected into value:
// '${dbFile}'
```

**Remediation:**
1. Use parameterized queries. SQLite `ATTACH` does not support `?` parameters, so validate the path against an allowlist regex: `/^[a-zA-Z0-9_\-./]+$/`.
2. Quote/escape the alias using bracket notation `["alias"]`.
3. Validate `table.name` against `sqlite_master` metadata rather than interpolating it.

---

#### SEC-003: Unsafe `eval()` and `new AsyncFunction()` for Code Execution

| Field | Value |
|-------|-------|
| ID | SEC-003 |
| Severity | CRITICAL |
| CVSS | 9.8 |
| CWE | CWE-94 (Code Injection) |
| OWASP | A03:2021 Injection |

**Description:** The browser dashboard `server-real.js` executes user-submitted code via `new AsyncFunction()` with minimal sandboxing (only `console` and `sendMCPCommand` are provided, but the full Node.js runtime is accessible). The consciousness code generator uses `eval()` on self-modifying code strings.

**Affected Files:**

| File | Lines | Vector |
|------|-------|--------|
| `v2/examples/browser-dashboard/server-real.js` | 273-274 | `new AsyncFunction('console', 'sendMCPCommand', code)` -- `code` comes from WebSocket client |
| `v2/src/consciousness-symphony/consciousness-code-generator.js` | 316 | `eval(\`(\${newVersion})\`)` -- self-modifying code pattern |
| `v3/@claude-flow/cli/src/mcp-tools/validate-input.ts` | 140 | `Function('return import("@claude-flow/security")')()` -- dynamic import via Function constructor |

**Remediation:**
1. Remove the code execution endpoint from the browser dashboard entirely, or replace it with a sandboxed VM (`vm2` or `isolated-vm`).
2. Remove the `eval()` in consciousness-code-generator.js.
3. Replace the `Function('return import(...)')` with a standard dynamic `import()`.

---

#### SEC-004: Committed `.env` File in Git History

| Field | Value |
|-------|-------|
| ID | SEC-004 |
| Severity | CRITICAL |
| CVSS | 8.5 |
| CWE | CWE-200 (Information Exposure) |
| OWASP | A01:2021 Broken Access Control |

**Description:** The file `ruflo/src/ruvocal/.env` was committed to git history. While the file's contents were not accessible for direct reading (permission denied in this scan), its presence in `git log --diff-filter=A` confirms it was added to version control. Even if `.gitignore` now covers `.env`, the file exists in git history and may contain API keys, database credentials, or other secrets.

**Affected Files:**

| File | Status |
|------|--------|
| `ruflo/src/ruvocal/.env` | Committed to git history |
| `ruflo/src/ruvocal/.env.ci` | Also present (likely contains CI-specific secrets) |

**Remediation:**
1. Audit the contents of `ruflo/src/ruvocal/.env` immediately.
2. Rotate ALL credentials that were ever stored in this file.
3. Use `git filter-repo` or BFG Repo-Cleaner to remove the file from git history.
4. Add `**/.env` (with double-star glob) to `.gitignore` to cover all subdirectories.

---

### HIGH

#### SEC-005: Prototype Pollution in `mergeDeep` -- No `__proto__` Guard

| Field | Value |
|-------|-------|
| ID | SEC-005 |
| Severity | HIGH |
| CVSS | 7.5 |
| CWE | CWE-1321 (Prototype Pollution) |

**Description:** Multiple `mergeDeep` implementations iterate over object keys without filtering `__proto__`, `constructor`, or `prototype`. An attacker who can control the source object (e.g., via API body, configuration file, or agent memory payload) can pollute `Object.prototype`.

**Affected Files:**

| File | Lines | Has Guard? |
|------|-------|-----------|
| `v2/bin/init/hive-mind-init.js` | 748-763 | No |
| `v2/src/utils/helpers.ts` | 215-244 | Partial (uses `hasOwnProperty` but no `__proto__` filter) |
| `v2/src/utils/key-redactor.ts` | 95-96 | No |
| `v3/@claude-flow/shared/src/core/config/loader.ts` | 193, 263 | No |
| `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` | 247 | No |

**Note:** The V3 memory package has `json-security.ts` with `safeJsonParse` that strips dangerous keys, but this is only used in the memory subsystem, not in configuration merging or API body processing.

**Remediation:**
1. Add `__proto__`, `constructor`, `prototype` filtering to all `mergeDeep` / `deepMerge` functions.
2. Centralize on one safe implementation and import it everywhere.
3. Consider using `Object.create(null)` for merge targets.

---

#### SEC-006: Wildcard CORS on WebSocket and HTTP Servers

| Field | Value |
|-------|-------|
| ID | SEC-006 |
| Severity | HIGH |
| CVSS | 7.5 |
| CWE | CWE-942 (CORS Misconfiguration) |

**Description:** Multiple HTTP and WebSocket servers set `Access-Control-Allow-Origin: *`, allowing any website to make cross-origin requests. Combined with the lack of authentication on most of these servers, this enables CSRF-style attacks from malicious web pages.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/bin/web-server.js` | 64-66, 148-150 |
| `v2/examples/browser-dashboard/server.js` | 54 |
| `v2/examples/browser-dashboard/server-real.js` | 155 |
| `v2/examples/blog-api/server.js` | 9 |
| `v2/src/index.js` | 7 |
| `v2/bin/init/batch-init.js` | 157 |

**Remediation:**
1. Replace wildcard `*` with specific allowed origins.
2. When servers must be localhost-only, bind to `127.0.0.1` and set origin to `http://localhost:{port}`.
3. Implement CSRF token validation for state-changing operations.

---

#### SEC-007: Unauthenticated WebSocket Server with Tool Execution

| Field | Value |
|-------|-------|
| ID | SEC-007 |
| Severity | HIGH |
| CVSS | 8.1 |
| CWE | CWE-306 (Missing Authentication) |

**Description:** The V2 web-server.js WebSocket server accepts connections without any authentication and allows `tools/call` method invocations. Any process or browser on the same machine (or network if not bound to localhost) can connect and execute MCP tools.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/bin/web-server.js` | 82-85 (WebSocket setup), 413-438 (message handler with `tools/call`) |

**Note:** The V3 MCP server (`v3/@claude-flow/mcp/src/transport/http.ts`, lines 284-320) DOES implement token-based auth with timing-safe comparison. But auth is **disabled by default** (`isAuthenticated: !this.config.auth?.enabled` -- line 236 in websocket.ts) and only enforced when explicitly enabled in config.

**Remediation:**
1. Enable auth by default in V3 MCP transport config.
2. Add authentication to the V2 WebSocket server.
3. Bind servers to `127.0.0.1` by default.

---

#### SEC-008: Insecure Randomness for Security-Relevant Identifiers

| Field | Value |
|-------|-------|
| ID | SEC-008 |
| Severity | HIGH |
| CVSS | 6.5 |
| CWE | CWE-330 (Insufficient Randomness) |

**Description:** `Math.random()` is used throughout the V2 codebase to generate session IDs, swarm IDs, task IDs, and execution IDs. `Math.random()` is not cryptographically secure and produces predictable values, enabling session hijacking or ID guessing.

**Affected Files (sample):**

| File | Lines | ID Type |
|------|-------|---------|
| `v2/bin/hook-safety.js` | 53 | Session ID |
| `v2/bin/hooks.js` | 23 | Hook ID |
| `v2/bin/task.js` | 72 | Task ID |
| `v2/bin/swarm.js` | 985, 1240, 1561 | Swarm ID |
| `v2/bin/automation-executor.js` | 16 | Execution ID |
| `v2/bin/coordination.js` | 13 | Coordination ID |
| `v2/bin/hive-mind-wizard.js` | 205 | Swarm ID |

**Remediation:**
1. Replace `Math.random().toString(36).substr(2, 9)` with `crypto.randomUUID()` or `crypto.randomBytes(16).toString('hex')`.
2. The V3 `@claude-flow/security/token-generator.ts` already uses `crypto.randomBytes` -- use it in V2 code.

---

#### SEC-009: Missing Request Size Limits on HTTP Body Parsing

| Field | Value |
|-------|-------|
| ID | SEC-009 |
| Severity | HIGH |
| CVSS | 6.5 |
| CWE | CWE-770 (Resource Exhaustion) |

**Description:** Several Express servers use `express.json()` without body size limits, enabling denial-of-service through oversized request payloads.

**Affected Files:**

| File | Details |
|------|---------|
| `v2/examples/blog-api/server.js` | No body size limit |
| `v2/examples/user-api/server.js` | No body size limit |
| `v2/examples/rest-api-simple/index.js` | No body size limit |
| `v2/src/index.js` | No body size limit |

**Remediation:** Add `express.json({ limit: '1mb' })` (or appropriate limit) to all Express server configurations.

---

#### SEC-010: Mass Assignment via Spread Operator on `req.body`

| Field | Value |
|-------|-------|
| ID | SEC-010 |
| Severity | HIGH |
| CVSS | 7.3 |
| CWE | CWE-915 (Mass Assignment) |

**Description:** Several endpoints spread `req.body` directly into objects, allowing clients to set arbitrary fields including `id`, `role`, `isAdmin`, `createdAt`, or internal fields.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/bin/swarm.js` | 1635 (`...req.body`) |
| `v2/examples/blog-api/routes/users.js` | 24, 38 |
| `v2/examples/user-api/server.js` | 42, 52 |

**Remediation:**
1. Destructure only expected fields: `const { name, email } = req.body`.
2. Use Zod or Joi schemas to validate and pick allowed fields.

---

#### SEC-011: No Security Headers on V2 Web Server or WebSocket Server

| Field | Value |
|-------|-------|
| ID | SEC-011 |
| Severity | HIGH |
| CVSS | 5.3 |
| CWE | CWE-693 (Protection Mechanism Failure) |

**Description:** The V2 web server (`v2/bin/web-server.js`) and its WebSocket server do not set any security headers (Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security). The V3 HTTP transport and ruvocal app DO use helmet -- but V2 does not.

**Remediation:** Add `helmet()` middleware to all Express-based servers.

---

#### SEC-012: V2 GitHub CLI Wrapper Command Injection

| Field | Value |
|-------|-------|
| ID | SEC-012 |
| Severity | HIGH |
| CVSS | 8.6 |
| CWE | CWE-78 (OS Command Injection) |

**Description:** The `github-safe.js` template, ironically named "safe", joins user arguments into a shell command string and passes it to `execSync()`:

```javascript
execSync(`gh ${args.join(' ')}`, { stdio: 'inherit' });
```

If any argument contains shell metacharacters, arbitrary commands can be injected.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/bin/init/templates/github-safe.js` | 80, 101, 105 |
| `v2/bin/init/templates/enhanced-templates.js` | 1400, 1418, 1422 |

**Remediation:** Use `execFileSync('gh', args)` without shell interpretation.

---

#### SEC-013: XSS via `innerHTML` in Browser Dashboard

| Field | Value |
|-------|-------|
| ID | SEC-013 |
| Severity | HIGH |
| CVSS | 6.1 |
| CWE | CWE-79 (Cross-Site Scripting) |

**Description:** The browser dashboard client-side JavaScript uses `innerHTML` extensively to render data received from WebSocket messages. If any data contains HTML/JavaScript, it will be executed in the browser context.

**Affected Files:**

| File | Lines |
|------|-------|
| `v2/examples/browser-dashboard/dashboard.js` | 112, 117, 279 |
| `v2/examples/browser-dashboard/dashboard-code.js` | 184, 186, 189-190, 207, 212, 355, 370, 482-483 |
| `v2/examples/browser-dashboard/dashboard-chat.js` | 169, 206, 230, 270, 283, 288 |

**Remediation:** Use `textContent` instead of `innerHTML`, or sanitize with DOMPurify before injection.

---

### MEDIUM

#### SEC-014: Unvalidated JSON.parse on External/Untrusted Data

| Field | Value |
|-------|-------|
| ID | SEC-014 |
| Severity | MEDIUM |
| CVSS | 5.3 |
| CWE | CWE-502 (Deserialization) |

**Description:** Over 60 instances of `JSON.parse()` on data from files, network, and WebSocket messages throughout V2 without validation. While `safeJsonParse` exists in `v3/@claude-flow/memory/src/json-security.ts`, it is not used outside the memory subsystem.

**Key Locations:**

| File | Lines | Source |
|------|-------|--------|
| `v2/bin/web-server.js` | 415 | WebSocket `data.toString()` |
| `v2/bin/github/github-api.js` | 372 | Webhook `payload` |
| `v2/bin/verification-hooks.js` | 16 | Command-line `args[3]` |
| `v2/bin/batch-manager.js` | 124, 264 | Config file content |
| `v2/bin/hive-mind.js` | 993, 1021 | Fallback data files |

**Remediation:** Adopt `safeJsonParse` from `json-security.ts` across the codebase, or at minimum wrap in try/catch with schema validation (Zod).

---

#### SEC-015: Path Traversal in V2 File Operations

| Field | Value |
|-------|-------|
| ID | SEC-015 |
| Severity | MEDIUM |
| CVSS | 5.3 |
| CWE | CWE-22 (Path Traversal) |

**Description:** V2 file operations (`readFile`, `writeFile`, etc.) accept paths from configuration files, memory entries, and user input without traversal validation. The V3 `PathValidator` exists but is not wired into V2 code paths.

**Remediation:** Integrate `PathValidator` or at minimum validate that resolved paths stay within expected directories.

---

#### SEC-016: V3 MCP Authentication Disabled by Default

| Field | Value |
|-------|-------|
| ID | SEC-016 |
| Severity | MEDIUM |
| CVSS | 6.5 |
| CWE | CWE-306 (Missing Authentication) |

**Description:** In `v3/@claude-flow/mcp/src/transport/websocket.ts:236`, new WebSocket sessions are initialized with `isAuthenticated: !this.config.auth?.enabled`. Since `auth` is undefined by default, all sessions are authenticated by default. This is a secure-by-default inversion.

**Remediation:** Flip the default: sessions should be unauthenticated until explicitly verified. Require auth configuration for production deployments.

---

#### SEC-017: Timing-Unsafe Token Comparison in V2

| Field | Value |
|-------|-------|
| ID | SEC-017 |
| Severity | MEDIUM |
| CVSS | 5.9 |
| CWE | CWE-208 (Timing Side-Channel) |

**Description:** V2 authentication code (where it exists) uses `===` for token comparison. The V3 HTTP transport (`v3/@claude-flow/mcp/src/transport/http.ts:299-303`) correctly uses timing-safe comparison, but V2 does not.

**Remediation:** Use `crypto.timingSafeEqual()` for all secret/token comparisons.

---

#### SEC-018: No Rate Limiting on V2 HTTP/WebSocket Servers

| Field | Value |
|-------|-------|
| ID | SEC-018 |
| Severity | MEDIUM |
| CVSS | 5.3 |
| CWE | CWE-799 (Resource Exhaustion) |

**Description:** V2 web server and WebSocket server have no rate limiting. The V3 MCP server has rate limiting (100 req/s with 200 burst), but V2 servers do not.

**Remediation:** Add rate limiting middleware (e.g., `express-rate-limit`) to all V2 servers.

---

#### SEC-019: Agent Memory Poisoning -- No Access Control on Memory Namespaces

| Field | Value |
|-------|-------|
| ID | SEC-019 |
| Severity | MEDIUM |
| CVSS | 6.5 |
| CWE | CWE-284 (Access Control) |

**Description:** The V3 memory system supports `namespace`, `ownerId`, and `accessLevel` fields in the `QueryBuilder`, but there is no enforcement layer that prevents one agent from reading or writing another agent's memory namespace. All agents can store and query all namespaces.

**Remediation:**
1. Implement namespace-level access control enforcement in the AgentDB adapter.
2. Validate `ownerId` matches the requesting agent's identity before write operations.
3. Create scoped memory contexts per agent.

---

#### SEC-020: Dynamic `import()` via `Function` Constructor

| Field | Value |
|-------|-------|
| ID | SEC-020 |
| Severity | MEDIUM |
| CVSS | 5.3 |
| CWE | CWE-94 (Code Injection) |

**Description:** `validate-input.ts:140` uses `Function('return import("@claude-flow/security")')()` to perform a dynamic import. While the module name is hardcoded (not user-controlled), using `Function()` to construct executable code is a code smell that security linters flag.

**Remediation:** Replace with standard `await import('@claude-flow/security')`.

---

#### SEC-021: Error Messages Leak Internal Paths and Stack Traces

| Field | Value |
|-------|-------|
| ID | SEC-021 |
| Severity | MEDIUM |
| CVSS | 4.3 |
| CWE | CWE-209 (Information Exposure) |

**Description:** Multiple error handlers throughout V2 expose `error.message` (which often contains file paths, SQL queries, and stack traces) to WebSocket clients and HTTP responses.

**Key Locations:**

| File | Lines |
|------|-------|
| `v2/bin/web-server.js` | 107 |
| `v2/bin/memory-consolidation.js` | 383 |
| `v2/bin/automation-executor.js` | 1399 |

**Remediation:** Return generic error messages to clients; log detailed errors server-side only.

---

#### SEC-022: No Data-at-Rest Encryption for SQLite Databases

| Field | Value |
|-------|-------|
| ID | SEC-022 |
| Severity | MEDIUM |
| CVSS | 4.0 |
| CWE | CWE-311 (Missing Encryption) |

**Description:** All SQLite databases (AgentDB, hive-mind, sessions, memory) store data unencrypted on disk. Agent memory may contain sensitive patterns, credentials references, and proprietary code snippets.

**Remediation:** Consider SQLCipher for encrypted SQLite, or OS-level disk encryption.

---

#### SEC-023: IPFS Plugin Registry Integrity -- No Signature Verification

| Field | Value |
|-------|-------|
| ID | SEC-023 |
| Severity | MEDIUM |
| CVSS | 6.5 |
| CWE | CWE-494 (Download Without Integrity Check) |

**Description:** The IPFS plugin registry (`v3/@claude-flow/cli/cloud-functions/publish-registry/index.js`) publishes plugins to IPFS via Pinata but clients that fetch the registry only validate the CID (content hash). There is no code-signing verification of individual plugin packages -- a compromised registry CID could serve malicious plugins.

**Remediation:**
1. Sign the registry JSON with an asymmetric key and verify signatures client-side.
2. Include per-plugin SHA-256 checksums in the registry manifest.
3. Implement a plugin allowlist in the CLI.

---

#### SEC-024: Recursive `mergeDeep` Without Depth Limit -- Stack Overflow DoS

| Field | Value |
|-------|-------|
| ID | SEC-024 |
| Severity | MEDIUM |
| CVSS | 5.3 |
| CWE | CWE-674 (Uncontrolled Recursion) |

**Description:** All `mergeDeep` / `deepMerge` / `deepClone` functions use unbounded recursion. A deeply nested object (e.g., 10,000 levels) will overflow the call stack and crash the process.

**Affected Files:**

| File |
|------|
| `v2/bin/init/hive-mind-init.js:748` |
| `v2/src/utils/helpers.ts:192,215` |
| `v3/@claude-flow/shared/src/core/config/loader.ts:263` |

**Remediation:** Add a depth limit parameter (e.g., max 20 levels).

---

#### SEC-025: No Input Validation on V2 MCP `tools/call` Handler

| Field | Value |
|-------|-------|
| ID | SEC-025 |
| Severity | MEDIUM |
| CVSS | 6.5 |
| CWE | CWE-20 (Improper Input Validation) |

**Description:** The V2 web server's WebSocket `tools/call` handler (`v2/bin/web-server.js:428`) dispatches tool invocations based on the parsed JSON message without validating tool names, parameters, or types. The V3 MCP server has `validate-input.ts` with `validateIdentifier`, `validatePath`, etc. -- but this is absent from V2.

**Remediation:** Add input validation to all V2 WebSocket message handlers.

---

### LOW

#### SEC-026: `npm audit` Not Enforced in CI

| Field | Value |
|-------|-------|
| ID | SEC-026 |
| Severity | LOW |

**Description:** No evidence of `npm audit` being run as part of CI/CD pipelines. Dependency vulnerabilities may be introduced silently.

---

#### SEC-027: Overly Permissive Dependency Version Ranges

| Field | Value |
|-------|-------|
| ID | SEC-027 |
| Severity | LOW |

**Description:** Multiple `package.json` files use `^` (caret) ranges which allow minor version upgrades. While standard, this can pull in vulnerable minor releases automatically.

---

#### SEC-028: V2 Daemon Does Not Drop Privileges

| Field | Value |
|-------|-------|
| ID | SEC-028 |
| Severity | LOW |

**Description:** The daemon process runs with the same privileges as the user who starts it. No privilege dropping after startup.

---

#### SEC-029: WebSocket Connections Not Limited

| Field | Value |
|-------|-------|
| ID | SEC-029 |
| Severity | LOW |

**Description:** V2 WebSocket server does not limit the number of concurrent connections. A simple script could open thousands of connections to exhaust memory.

---

#### SEC-030: V2 `hive-mind/memory.js` SQL Uses Some Parameterized Queries But Not All

| Field | Value |
|-------|-------|
| ID | SEC-030 |
| Severity | LOW |

**Description:** `v2/bin/hive-mind/memory.js:618` uses `db.prepare(query).all(...params)` correctly for some queries, but several `db.exec()` calls in the same file use template literals. Inconsistent parameterization increases the attack surface.

---

#### SEC-031: `console.log` of WebSocket Message Content

| Field | Value |
|-------|-------|
| ID | SEC-031 |
| Severity | LOW |

**Description:** `v2/bin/web-server.js:416` logs received WebSocket message method and ID, which could leak sensitive tool names and identifiers to stdout/logs.

---

#### SEC-032: V2 Config Files Read Without Schema Validation

| Field | Value |
|-------|-------|
| ID | SEC-032 |
| Severity | LOW |

**Description:** Configuration files are loaded via `JSON.parse(readFileSync(...))` without any schema validation. Malformed or malicious config files could cause unexpected behavior.

---

#### SEC-033: No Content-Length Validation on WebSocket Messages

| Field | Value |
|-------|-------|
| ID | SEC-033 |
| Severity | LOW |

**Description:** WebSocket messages are parsed without size limits. A client could send extremely large JSON payloads.

---

### INFO

#### SEC-034: V3 Security Package Well-Designed But Under-Adopted

The `@claude-flow/security` package contains solid implementations:
- `SafeExecutor` with command allowlist and shell: false
- `PathValidator` with traversal detection and symlink resolution
- `InputValidator` with Zod schemas
- `safeJsonParse` with proto pollution prevention

However, these are only used in V3 code paths. V2 code (which represents approximately 60% of the codebase) does not use them.

---

#### SEC-035: Key Redaction Module Present

`v2/src/utils/key-redactor.ts` provides `sk-ant-*` pattern redaction. This is good but only covers Anthropic keys -- other provider keys (OpenAI `sk-`, Google, Azure) should also be covered.

---

#### SEC-036: V3 MCP Rate Limiter Correctly Configured

The V3 MCP server rate limiter (100 req/s, 200 burst, 50 per-session) is well-configured for local use.

---

#### SEC-037: V3 Path Validator Has Comprehensive Traversal Detection

Detection includes `../`, `..\`, URL-encoded variants (`%2e%2e`), double-encoded (`%252e%252e`), mixed encoding, and null bytes. This is thorough.

---

#### SEC-038: V3 Safe Executor Blocks Dangerous Commands

The `DANGEROUS_COMMANDS` blocklist includes `rm`, `rmdir`, `chmod`, `kill`, `reboot`, etc. This is a good defense-in-depth measure.

---

## Dependency Vulnerability Summary

| Package Area | Packages Scanned | Known Vulnerable | Notes |
|-------------|-----------------|-----------------|-------|
| Root `package.json` | 1 | Not assessed (npm audit not run) | Run `npm audit` to verify |
| V2 `package.json` | 1 | Not assessed | Large dependency tree |
| V3 packages | 20+ | Not assessed | Most use workspace refs |
| Example apps | 12 | Higher risk | Examples may use outdated deps |

**Recommendation:** Run `npm audit` across all package directories and remediate any critical/high findings.

---

## Secrets Scan Results

| Pattern | Matches | Status |
|---------|---------|--------|
| `sk-ant-*` (Anthropic key) | 8 | All are regex patterns in scanners/redactors -- no live keys |
| `AKIA*` (AWS key) | 0 | Clean |
| `ghp_*` (GitHub token) | 0 | Clean |
| `-----BEGIN PRIVATE KEY-----` | 6 | All are regex patterns in security scanners -- no live keys |
| `password = "..."` | 4 | Examples in docs/templates -- not live |
| Committed `.env` files | 1 | **SEC-004: `ruflo/src/ruvocal/.env` in git history** |
| Base64-encoded secrets | 0 | Clean |

---

## Attack Surface Map

```
EXTERNAL ATTACK SURFACE
========================

[Internet/Network]
     |
     v
[V2 Web Server :PORT]  ---- No Auth, CORS *, No Rate Limit
     |                       SEC-006, SEC-007, SEC-009, SEC-011, SEC-018
     |-- HTTP API (express)
     |-- WebSocket (/ws)  -- tools/call, initialize, no validation
     |                       SEC-025, SEC-029, SEC-033
     |
[V2 REST API Examples]  ---- CORS *, No Auth, ...req.body spread
     |                       SEC-006, SEC-009, SEC-010
     |
[Browser Dashboard]     ---- AsyncFunction code exec, innerHTML XSS
                             SEC-003, SEC-013

LOCAL/AGENT ATTACK SURFACE
===========================

[CLI Commands]
     |
     v
[execSync with interpolation] -- SEC-001 (multiple files)
     |
[ATTACH DATABASE '${var}']    -- SEC-002
     |
[Memory Store/Query]          -- SEC-019 (no namespace ACL)
     |
[SQLite Databases]            -- SEC-022 (no encryption)
     |
[Config Files]                -- SEC-005 (mergeDeep prototype pollution)
     |
[IPFS Plugin Registry]       -- SEC-023 (no signature verification)
     |
[Agent Task Payloads]        -- SEC-019 (memory poisoning)
```

---

## Prioritized Recommendations

### Immediate (This Sprint)

| Priority | Action | Findings | Effort |
|----------|--------|----------|--------|
| P0 | Rotate credentials from committed `.env` file | SEC-004 | Low |
| P0 | Replace `execSync(interpolatedString)` with `execFileSync` in V2 | SEC-001, SEC-012 | Medium |
| P0 | Remove or sandbox browser dashboard code execution | SEC-003 | Low |
| P0 | Parameterize ATTACH DATABASE SQL | SEC-002 | Low |

### Short-Term (Next 2 Sprints)

| Priority | Action | Findings | Effort |
|----------|--------|----------|--------|
| P1 | Add `__proto__` guards to all `mergeDeep` functions | SEC-005 | Low |
| P1 | Enable auth by default on V3 MCP WebSocket transport | SEC-016 | Low |
| P1 | Add auth to V2 WebSocket server | SEC-007 | Medium |
| P1 | Replace `Math.random()` IDs with `crypto.randomUUID()` | SEC-008 | Low |
| P1 | Restrict CORS origins on all servers | SEC-006 | Low |
| P1 | Add body size limits to Express servers | SEC-009 | Low |

### Medium-Term (Next Quarter)

| Priority | Action | Findings | Effort |
|----------|--------|----------|--------|
| P2 | Adopt `@claude-flow/security` validators in V2 codebase | SEC-014, SEC-015, SEC-025 | High |
| P2 | Add security headers (helmet) to V2 servers | SEC-011 | Low |
| P2 | Implement memory namespace access control | SEC-019 | Medium |
| P2 | Add plugin signature verification to IPFS registry | SEC-023 | Medium |
| P2 | Add depth limits to recursive merge functions | SEC-024 | Low |
| P2 | Replace `innerHTML` with safe DOM APIs | SEC-013 | Medium |

### Long-Term

| Priority | Action | Findings | Effort |
|----------|--------|----------|--------|
| P3 | Implement SQLite encryption (SQLCipher) | SEC-022 | High |
| P3 | Run `npm audit` in CI/CD pipeline | SEC-026 | Low |
| P3 | Deprecate V2 codebase in favor of V3 security architecture | Multiple | High |
| P3 | Implement agent identity and privilege boundaries | SEC-019 | High |

---

## Methodology

This scan was performed through static analysis of 2,414 source files across the RuFlo monorepo. Techniques used:

1. **SAST**: Regex pattern scanning for OWASP Top 10 and CWE SANS 25 vulnerability patterns including command injection, SQL injection, path traversal, prototype pollution, eval/Function usage, insecure randomness, and hardcoded credentials.
2. **Secrets Detection**: Pattern-based scanning for API keys (sk-ant-, AKIA, ghp_), private keys (BEGIN PRIVATE KEY), passwords, and tokens across all source files, config files, and JSON.
3. **Configuration Review**: Manual review of server configurations, CORS settings, authentication mechanisms, rate limiting, and security headers.
4. **Data Flow Analysis**: Tracing user-controlled input from entry points (CLI args, WebSocket messages, HTTP requests, config files) through to security-sensitive operations (exec, SQL, file I/O).
5. **Architecture Review**: Assessment of inter-agent communication, memory access controls, MCP tool authorization, and plugin registry integrity.
6. **Git History Analysis**: Checking for committed secrets files in version control history.

---

*Report generated by V3 QE Security Scanner -- 2026-04-28*
