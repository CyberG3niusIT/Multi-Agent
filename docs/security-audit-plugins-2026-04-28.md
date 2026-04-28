# RuFlo Plugin System Security Audit Report

**Date:** 2026-04-28
**Auditor:** Security Specialist (Automated Deep Analysis)
**Scope:** All plugin subsystems across the RuFlo monorepo
**Branch:** qe-working-branch (commit f9f0e5bce)
**Classification:** CONFIDENTIAL

---

## Executive Summary

This audit examined the entire RuFlo plugin ecosystem: 20+ v3 plugins, 20 ruflo-level Claude Code plugins, the CLI plugin manager, the IPFS-based discovery/registry system, and the plugin SDK. The analysis covered over 150 source files across the plugin infrastructure.

The project demonstrates strong security awareness in several areas -- notably the gastown-bridge plugin with its Zod-validated inputs, OWASP-aligned sanitizers, and `execFile` usage instead of shell-based `exec`. The plugin security module (`@claude-flow/plugins/src/security/index.ts`) provides a solid foundation for path traversal prevention, JSON safety, command validation, and rate limiting.

However, the audit uncovered **4 Critical**, **6 High**, **7 Medium**, and **5 Low** severity findings. The most severe issues center on: (1) a broken registry signature verification that renders the entire IPFS supply chain untrustworthy; (2) no plugin sandboxing, meaning any installed plugin executes with full process privileges; (3) shell-injection-adjacent patterns in `gastown-bridge/src/index.ts` and `teammate-plugin`; and (4) unsafe JSON deserialization without prototype pollution guards in multiple plugins.

**Overall Risk Rating: HIGH** -- the plugin system's trust model has fundamental gaps that would allow a malicious or compromised plugin to take full control of the host process and exfiltrate data.

---

## Findings Summary

| ID | Severity | Title | CVSS | Status |
|----|----------|-------|------|--------|
| CRIT-01 | CRITICAL | Registry signature verification is a no-op | 9.8 | Open |
| CRIT-02 | CRITICAL | No plugin sandboxing -- full process access | 9.1 | Open (acknowledged) |
| CRIT-03 | CRITICAL | Shell injection via `exec()` in gastown-bridge index | 8.6 | Open |
| CRIT-04 | CRITICAL | IPFS registry fallback to unverified demo data | 8.4 | Open |
| HIGH-01 | HIGH | `execSync` shell command execution in teammate-bridge | 7.8 | Open |
| HIGH-02 | HIGH | Unsafe `JSON.parse` without prototype pollution guard (multiple plugins) | 7.5 | Open |
| HIGH-03 | HIGH | IPFS content fetched over HTTP without checksum verification | 7.2 | Open |
| HIGH-04 | HIGH | Plugin loading does not verify code integrity or signatures | 7.0 | Open |
| HIGH-05 | HIGH | Environment variable mutation from plugin code | 6.8 | Open |
| HIGH-06 | HIGH | Dependency confusion via npm install from user-supplied names | 6.5 | Open |
| MED-01 | MEDIUM | `safeJSONParse` in teammate-bridge lacks `__proto__` stripping | 5.5 | Open |
| MED-02 | MEDIUM | Unvalidated user input passed to `JSON.parse` in legal-contracts | 5.3 | Open |
| MED-03 | MEDIUM | IPFS gateways contacted over HTTPS but no certificate pinning | 5.0 | Open |
| MED-04 | MEDIUM | Plugin config merging vulnerable to prototype pollution | 4.8 | Open |
| MED-05 | MEDIUM | Singleton PluginManager allows config confusion | 4.5 | Open |
| MED-06 | MEDIUM | Cache poisoning in IPFS client (in-memory cache with no integrity check) | 4.3 | Open |
| MED-07 | MEDIUM | Rate limiting not applied to plugin store API calls | 4.0 | Open |
| LOW-01 | LOW | Verbose error messages may leak internal paths | 3.5 | Open |
| LOW-02 | LOW | No maximum depth on recursive `redactSensitiveFields` | 3.0 | Open |
| LOW-03 | LOW | Demo registry CID uses `crypto.randomBytes` -- not deterministic | 2.5 | Open |
| LOW-04 | LOW | Plugin manifest stored as world-readable JSON on filesystem | 2.0 | Open |
| LOW-05 | LOW | Missing `Content-Security-Policy` on IPFS gateway responses | 2.0 | Open |

---

## Detailed Findings

### CRIT-01: Registry Signature Verification Is a No-Op

**Severity:** CRITICAL (CVSS 9.8)
**File:** `v3/@claude-flow/cli/src/plugins/store/discovery.ts`, lines 1147-1153
**Category:** OWASP A08:2021 -- Software and Data Integrity Failures

**Description:**
The `verifyRegistrySignature` method is supposed to validate the Ed25519 signature of the plugin registry fetched from IPFS. The actual implementation only checks whether the `registryPublicKey` field *starts with* the same prefix as the expected key:

```typescript
private verifyRegistrySignature(registry: PluginRegistry, expectedPublicKey: string): boolean {
  if (!registry.registrySignature || !registry.registryPublicKey) {
    return false;
  }
  // In production: Verify Ed25519 signature
  return registry.registryPublicKey.startsWith(expectedPublicKey.split(':')[0]);
}
```

This means: (a) the actual cryptographic signature is never verified; (b) any registry that self-declares a public key starting with `ed25519` passes verification; (c) the `requireVerification: true` config option provides a false sense of security. Furthermore, when verification fails, the code only emits a `console.warn` (line 183) and proceeds to use the registry anyway -- the failure is not treated as blocking.

**Impact:** An attacker who can serve a modified IPFS object (via DNS hijacking, IPFS gateway compromise, or CID collision) can inject arbitrary plugins into the registry, which users will install trusting the "verified" badge.

**Proof of Concept:** Craft a registry JSON with `registryPublicKey: "ed25519:aaaa..."` and any `registrySignature`. It will pass verification.

**Remediation:**
1. Implement actual Ed25519 signature verification using the existing `verifyEd25519Signature` function in `transfer/ipfs/client.ts`.
2. When verification fails and `requireVerification` is true, refuse to use the registry -- do not fall through to the demo.
3. Pin the expected public key in the binary, not just in the config.

---

### CRIT-02: No Plugin Sandboxing -- Full Process Access

**Severity:** CRITICAL (CVSS 9.1)
**File:** `v3/@claude-flow/cli/src/plugins/manager.ts`, line 332 (acknowledged); `v3/@claude-flow/plugins/src/registry/plugin-registry.ts`
**Category:** OWASP A04:2021 -- Insecure Design

**Description:**
The plugin system defines a permission model (`PluginPermission` type in `types.ts` includes `network`, `filesystem`, `execute`, `credentials`, `privileged`), but this model is purely declarative. No enforcement mechanism exists:

- Plugins are loaded via `npm install` and then executed with `require()` in the same Node.js process.
- The `enable()` method in `manager.ts` (line 332) correctly emits a security warning: `"[SECURITY] Plugin loaded without sandboxing: ${packageName}. Plugins run with full process access."`, but no isolation is applied.
- The `allowedPermissions` config (`['network', 'filesystem', 'memory', 'hooks']`) is never checked against a plugin's declared permissions before loading.
- The `requirePermissionPrompt: true` setting is never referenced in any enforcement code.

**Impact:** Any installed plugin, including community/unverified plugins, has full access to: the filesystem, network, environment variables, child process spawning, and all in-memory data of the host process. A malicious plugin could exfiltrate API keys, credentials, and project source code.

**Remediation:**
1. Implement permission enforcement before plugin initialization (compare declared vs. allowed permissions).
2. Investigate Node.js `vm.Module` or `isolated-vm` for sandboxing plugin execution.
3. At minimum, enforce `requirePermissionPrompt` with an interactive confirmation before enabling plugins that declare `credentials`, `execute`, or `privileged` permissions.

---

### CRIT-03: Shell Injection via `exec()` in Gastown-Bridge Index

**Severity:** CRITICAL (CVSS 8.6)
**File:** `v3/plugins/gastown-bridge/src/index.ts`, lines 1038-1050
**Category:** OWASP A03:2021 -- Injection

**Description:**
The `checkCliAvailable` method dynamically imports `child_process.exec` (the shell-based variant, not `execFile`) and runs:

```typescript
const { exec } = await import('child_process');
const { promisify } = await import('util');
const execAsync = promisify(exec);
await execAsync('which gt');
await execAsync('which bd');
```

While the immediate commands (`which gt`, `which bd`) are hardcoded strings and not directly injectable, the use of `exec` (shell-based) instead of `execFile` is problematic. This pattern is dangerous because: (a) if the `config.gtBridge?.gtPath` or `config.bdBridge?.bdPath` values are ever passed to this function or a similar one, command injection becomes trivial; (b) it sets a bad precedent in a plugin that otherwise uses `execFile` correctly in its bridges.

This is particularly concerning because the gt-bridge and bd-bridge files correctly use `execFile` (the non-shell variant) with argument arrays, but this top-level file reverts to the unsafe `exec`.

**Impact:** If the `gt` or `bd` binary names are ever user-configurable (they are already configurable via `config.gtBridge?.gtPath`), this opens a direct command injection vector. Even without user control, `exec()` processes the command through `/bin/sh`, which can be exploited via `$PATH` manipulation.

**Remediation:**
1. Replace `exec` with `execFile`:
   ```typescript
   const { execFile } = await import('child_process');
   const execFileAsync = promisify(execFile);
   await execFileAsync('which', ['gt']);
   await execFileAsync('which', ['bd']);
   ```
2. Use the path from config only after validation against an allowlist of known binary names.

---

### CRIT-04: IPFS Registry Fallback to Unverified Demo Data

**Severity:** CRITICAL (CVSS 8.4)
**File:** `v3/@claude-flow/cli/src/plugins/store/discovery.ts`, lines 164-176, 199-203
**Category:** OWASP A08:2021 -- Software and Data Integrity Failures

**Description:**
When IPFS/IPNS resolution fails for any reason (network error, timeout, gateway unavailable), the discovery service silently falls back to a hardcoded "demo registry" via `createDemoRegistryAsync()`. This demo registry:

1. Contains fabricated plugin entries with fake CIDs (e.g., `bafybeineuralpatternplugin`), fake checksums (e.g., `sha256:abc123neural`), and fake download counts.
2. Generates a random CID using `crypto.randomBytes(16)` (line 260), making it non-deterministic and unverifiable.
3. Is returned as `success: true` with the source labeled as `${registry.name} (demo)`.

The calling code in `plugins.ts` does not distinguish between a real IPFS registry and the demo fallback when presenting plugins to the user or allowing installation.

**Impact:** An attacker who can force a network failure (e.g., DNS poisoning targeting IPFS gateways) forces the system into demo mode, where users see fabricated plugin data. This could be combined with a rogue npm package that matches one of the fabricated names.

**Remediation:**
1. When the registry cannot be verified, clearly indicate this to the user with a prominent warning -- not just "(demo)" in the source field.
2. Disable plugin installation when operating in demo/fallback mode.
3. Do not return `success: true` for fallback data.

---

### HIGH-01: Shell Command Execution via `execSync` in Teammate-Bridge

**Severity:** HIGH (CVSS 7.8)
**File:** `v3/plugins/teammate-plugin/src/teammate-bridge.ts`, lines 333, 2065, 2367, 2377
**Category:** OWASP A03:2021 -- Injection

**Description:**
The teammate-bridge uses `execSync` (shell-based execution) in four places:

1. Line 333: `execSync('claude --version 2>/dev/null', ...)` -- hardcoded, low direct risk but uses shell.
2. Line 2065: `execSync('which tmux', ...)` -- hardcoded, low direct risk but uses shell.
3. Line 2367: `execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', ...)` -- hardcoded, low direct risk.
4. Line 2377: `execSync('git config --get remote.origin.url 2>/dev/null', ...)` -- hardcoded, low direct risk.

While all commands are hardcoded strings (not user-injectable), the use of `execSync` with `2>/dev/null` shell redirection means these execute through `/bin/sh`. If a `PATH` manipulation attack occurs or if these patterns are copy-pasted with user input in the future, they become command injection vectors.

**Impact:** Currently limited due to hardcoded strings. Risk increases if any of these patterns are extended with user-controlled values. The `2>/dev/null` pattern specifically requires shell execution and prevents migration to `execFile`.

**Remediation:**
1. Replace shell-based `execSync` with `execFileSync` and handle stderr separately.
2. For `which` checks, use `fs.existsSync` on known paths or `require('which')` package.
3. For git commands, use `execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'])`.

---

### HIGH-02: Unsafe JSON.parse Without Prototype Pollution Guard (Multiple Plugins)

**Severity:** HIGH (CVSS 7.5)
**Files:**
- `v3/plugins/teammate-plugin/src/teammate-bridge.ts`, line 226
- `v3/plugins/gastown-bridge/src/formula/executor.ts`, line 1498
- `v3/plugins/legal-contracts/src/mcp-tools.ts`, line 1034
- `v3/plugins/prime-radiant/src/engines/CategoryEngine.ts`, line 324
- `v3/plugins/agentic-qe/src/bridges/QEHiveBridge.ts`, line 449
- `v3/plugins/gastown-bridge/src/convoy/observer.ts`, lines 517, 853, 858, 862
- `v3/plugins/gastown-bridge/src/wasm-loader.ts`, lines 797, 854, 905, 966, 1015
**Category:** OWASP A03:2021 -- Injection (Prototype Pollution)

**Description:**
Multiple plugins use bare `JSON.parse()` on data from external sources (CLI outputs, file contents, network responses) without stripping dangerous keys (`__proto__`, `constructor`, `prototype`). The plugin SDK provides a `safeJsonParse` function in `@claude-flow/plugins/src/security/index.ts` that strips these keys, but it is not used by any of the plugins examined.

The `safeJSONParse` function in `teammate-bridge.ts` (line 217) checks size limits but does NOT strip `__proto__`:

```typescript
function safeJSONParse<T>(content: string, maxSize: number = MAX_PAYLOAD_SIZE): T {
  if (content.length > maxSize) { throw ... }
  try { return JSON.parse(content) as T; } // No reviver!
  catch (error) { throw ... }
}
```

**Impact:** If a malicious bead, formula, mailbox message, or WASM result contains `{"__proto__": {"polluted": true}}`, it can pollute Object.prototype, affecting all JavaScript objects in the process. This can lead to authorization bypass, property injection, or denial of service.

**Remediation:**
1. Replace all `JSON.parse()` calls on untrusted data with the `safeJsonParse` from the security module, which uses a reviver to strip `__proto__`, `constructor`, and `prototype`.
2. Consider enforcing this via an ESLint rule (e.g., `no-restricted-globals` for bare `JSON.parse`).

---

### HIGH-03: IPFS Content Fetched Without Checksum Verification

**Severity:** HIGH (CVSS 7.2)
**File:** `v3/@claude-flow/cli/src/transfer/ipfs/client.ts`, lines 133-178
**Category:** OWASP A08:2021 -- Software and Data Integrity Failures

**Description:**
The `fetchFromIPFS` function fetches JSON from IPFS gateways but never verifies the content against the expected checksum or CID. While IPFS CIDs are content-addressed (the hash IS the address), HTTP gateways can serve modified content if compromised. Each `PluginEntry` in the registry includes a `checksum` field (e.g., `sha256:abc123neural`), but this checksum is never validated after download.

The `hashContent` function exists in the same file (line 317) but is never called from `fetchFromIPFS`.

**Impact:** A compromised IPFS gateway could serve malicious content that differs from what the CID should reference. Combined with CRIT-01 (broken signature verification), this creates a complete bypass of the supply chain integrity model.

**Remediation:**
1. After fetching content from IPFS, compute `sha256` of the received data and compare against the CID-derived hash or the `checksum` field.
2. Use `hashContent` to verify integrity before returning data.

---

### HIGH-04: Plugin Loading Does Not Verify Code Integrity or Signatures

**Severity:** HIGH (CVSS 7.0)
**File:** `v3/@claude-flow/cli/src/plugins/manager.ts`, `installFromNpm` and `installFromLocal` methods
**Category:** OWASP A08:2021 -- Software and Data Integrity Failures

**Description:**
When installing a plugin via `installFromNpm` or `installFromLocal`:

1. No cryptographic verification of the plugin package is performed.
2. The `verify` flag in the install command (line 228) defaults to `true` but is never passed to or checked by the `PluginManager`.
3. No signature verification is performed on the downloaded package.
4. The `securityAudit` field in plugin metadata is self-reported and never validated against an external audit authority.

**Impact:** A typosquatted or compromised npm package will be installed and executed without any integrity verification beyond npm's own HTTPS transport.

**Remediation:**
1. Verify npm package signatures using `npm audit signatures` after installation.
2. Compare installed package checksum against the registry's `checksum` field.
3. Implement a trust-on-first-use (TOFU) model for plugin signatures.

---

### HIGH-05: Environment Variable Mutation from Plugin Code

**Severity:** HIGH (CVSS 6.8)
**File:** `v3/plugins/teammate-plugin/src/teammate-bridge.ts`, lines 727, 730, 2032-2033
**Category:** OWASP A04:2021 -- Insecure Design

**Description:**
The teammate-bridge directly mutates `process.env` to set team context:

```typescript
process.env.CLAUDE_CODE_TEAM_NAME = sanitizeEnvValue(fullConfig.name);
process.env.CLAUDE_CODE_PLAN_MODE_REQUIRED = 'true';
```

And cleans up on destroy:
```typescript
delete process.env.CLAUDE_CODE_TEAM_NAME;
```

The `sanitizeEnvValue` function (line 238) only strips control characters but allows any printable string, including shell-significant characters like `=`, spaces, and quotes.

**Impact:** A plugin mutating `process.env` can affect all other plugins and the host process. A malicious plugin could: (a) override `PATH` to redirect command execution; (b) set `NODE_OPTIONS` to inject code; (c) modify API keys to redirect API calls.

**Remediation:**
1. Plugins should not mutate `process.env` directly. Provide a sandboxed environment accessor.
2. If env mutation is required, use a prefix and validate the value against a strict allowlist.
3. The `sanitizeEnvValue` function should reject `=` and shell metacharacters.

---

### HIGH-06: Dependency Confusion via npm Install

**Severity:** HIGH (CVSS 6.5)
**File:** `v3/@claude-flow/cli/src/plugins/manager.ts`, line 162
**Category:** OWASP A08:2021 -- Software and Data Integrity Failures

**Description:**
The `installFromNpm` method validates the package name format (line 158) but does not verify that the package name matches a known entry in the IPFS plugin registry before calling `npm install`. The regex `VALID_PACKAGE_RE` (line 17) permits any valid npm package name format.

The install command in `plugins.ts` (line 284) does look up the registry for metadata, but the `npm install` proceeds regardless of whether the plugin was found in the registry:

```typescript
if (plugin) {
  spinner.setText(`Found ${plugin.displayName} v${plugin.version}`);
}
// Install from npm (since IPFS is demo mode) -- proceeds even if plugin is null
spinner.setText(`Installing ${name} from npm...`);
result = await manager.installFromNpm(name, version !== 'latest' ? version : undefined);
```

**Impact:** An attacker could publish a malicious package on npm with a name similar to a known plugin (e.g., `@claude-flow/securty` instead of `@claude-flow/security`). Users who mistype the name will install the malicious package.

**Remediation:**
1. Only allow installation of plugins that exist in a verified registry.
2. Warn the user if the requested plugin name does not match any registry entry.
3. Consider maintaining a curated allowlist of installable packages.

---

### MED-01: `safeJSONParse` in Teammate-Bridge Lacks __proto__ Stripping

**Severity:** MEDIUM (CVSS 5.5)
**File:** `v3/plugins/teammate-plugin/src/teammate-bridge.ts`, lines 215-233
**Category:** CWE-1321 -- Improperly Controlled Modification of Object Prototype Attributes

**Description:**
The function named `safeJSONParse` implies safety but only enforces a size limit. It does not use a JSON reviver to strip `__proto__`, `constructor`, or `prototype` keys. This is particularly concerning for the mailbox parsing (line 1730, 2202) and team config parsing (line 895, 984) where data may originate from other teammates or external sources.

**Remediation:** Add a reviver that strips dangerous keys, or use the security module's `safeJsonParse`.

---

### MED-02: Unvalidated User Input to JSON.parse in Legal-Contracts

**Severity:** MEDIUM (CVSS 5.3)
**File:** `v3/plugins/legal-contracts/src/mcp-tools.ts`, line 1034

**Description:**
The `parsePlaybook` function directly passes user input to `JSON.parse`:

```typescript
function parsePlaybook(playbookInput: string): Playbook {
  try {
    const parsed = JSON.parse(playbookInput);
    return parsed as import('./types.js').Playbook;
  } catch {
    return { id: playbookInput, ... };
  }
}
```

The `playbookInput` string comes from MCP tool input and is neither size-limited nor validated for dangerous keys before parsing.

**Remediation:** Use `safeJsonParse` from the security module. Add input size limits.

---

### MED-03: IPFS Gateways -- No Certificate Pinning

**Severity:** MEDIUM (CVSS 5.0)
**File:** `v3/@claude-flow/cli/src/transfer/ipfs/client.ts`

**Description:**
All IPFS gateway connections use HTTPS but rely solely on the system CA store for certificate validation. No certificate pinning or key pinning is implemented. An attacker with access to a trusted CA (or who compromises the CA store) could MITM the connection.

**Remediation:** Consider implementing certificate pinning for the known gateway domains, or validate the IPFS content hash after download.

---

### MED-04: Plugin Config Merging Vulnerable to Prototype Pollution

**Severity:** MEDIUM (CVSS 4.8)
**File:** `v3/@claude-flow/cli/src/plugins/manager.ts`, line 501

**Description:**
The `setConfig` method uses spread operators to merge user-supplied config:

```typescript
plugin.config = { ...plugin.config, ...config };
```

While spread does a shallow copy and does not directly pollute prototypes, if `config` contains `__proto__` as a top-level key, it creates a property named `__proto__` on the config object. In older environments or when the config is later iterated with `for...in`, this can cause unexpected behavior.

**Remediation:** Sanitize the `config` parameter by stripping dangerous keys before merging.

---

### MED-05: Singleton PluginManager Allows Config Confusion

**Severity:** MEDIUM (CVSS 4.5)
**File:** `v3/@claude-flow/cli/src/plugins/manager.ts`, lines 527-539

**Description:**
The `getPluginManager` singleton function warns but does not prevent using a different `baseDir`:

```typescript
export function getPluginManager(baseDir?: string): PluginManager {
  if (!defaultManager) {
    defaultManager = new PluginManager(baseDir);
  } else if (baseDir && ...) {
    console.warn(`Warning: getPluginManager called with different baseDir...`);
  }
  return defaultManager;
}
```

If two callers request different base directories, the second silently gets the first's instance, potentially installing plugins in an unexpected location.

**Remediation:** Either throw an error when `baseDir` conflicts, or support multiple instances keyed by `baseDir`.

---

### MED-06: Cache Poisoning in IPFS Client

**Severity:** MEDIUM (CVSS 4.3)
**File:** `v3/@claude-flow/cli/src/plugins/store/discovery.ts`, lines 186-189

**Description:**
The in-memory cache stores the registry keyed by `ipnsName` with a 1-hour TTL. If a poisoned response is cached (e.g., from a compromised gateway during a transient period), it will be served for up to 1 hour without re-verification.

**Remediation:** Validate registry integrity (signature, checksum) even for cached entries. Reduce cache TTL or add cache invalidation on verification failure.

---

### MED-07: Rate Limiting Not Applied to Plugin Store API Calls

**Severity:** MEDIUM (CVSS 4.0)
**File:** `v3/@claude-flow/cli/src/plugins/store/discovery.ts`, `v3/@claude-flow/cli/src/commands/plugins.ts`

**Description:**
No rate limiting is applied to the plugin discovery, search, or rating API calls. A malicious actor could: (a) flood the IPFS gateways, (b) submit unlimited ratings to manipulate plugin rankings, (c) perform reconnaissance by rapidly enumerating the entire registry.

**Remediation:** Use the `createRateLimiter` from the security module for outbound API calls and rating submissions.

---

### LOW-01 through LOW-05

**LOW-01 (CVSS 3.5):** Error messages in `PluginManager` (lines 204-207) include the full npm error output, which may contain internal paths, environment details, or partial credentials if npm is misconfigured.

**LOW-02 (CVSS 3.0):** The `redactSensitiveFields` function in `gastown-bridge/src/sanitizers.ts` (line 464) recursively processes nested objects but has no depth limit. A deeply nested object could cause a stack overflow (DoS).

**LOW-03 (CVSS 2.5):** The demo registry generates a random CID (`bafybeiplugin${crypto.randomBytes(16).toString('hex')}`), which is non-deterministic. This prevents caching and makes debugging harder.

**LOW-04 (CVSS 2.0):** The plugin manifest (`installed.json`) is stored with default filesystem permissions, making it readable by any local user. It contains plugin paths, versions, and configuration.

**LOW-05 (CVSS 2.0):** IPFS gateway responses are consumed without checking `Content-Type` headers. A gateway could return non-JSON content that gets incorrectly parsed.

---

## Open Security Issues (from GitHub)

The following relevant open issues were found on `ruvnet/claude-flow`:

| # | Title | Priority |
|---|-------|----------|
| 1608 | `sec(deps): @claude-flow/security@3.0.0-alpha.1 ships tar <=7.5.10 transitively (6 HIGH CVEs via bcrypt -> @mapbox/node-pre-gyp)` | HIGH |
| 1609 | `sec(deps): multiple @claude-flow/* packages ship outdated vitest devDependencies with moderate CVE chain (esbuild -> vite)` | MEDIUM |
| 261 | `Security Concern: WASM files` | MEDIUM |
| 193 | `OWASP Top 10 Compliance Audit with 3-Agent Swarm` | MEDIUM |
| 1482 | `Security & Reliability Analysis -- Independent Review` | HIGH |
| 724 | `Add input validation for tool gating handlers in MCP server` | HIGH |
| 371 | `Claude Flow v2.0.0-alpha.62 Released - Critical Security Fixes` | REFERENCE |

Issue #1608 is particularly relevant: the `@claude-flow/security` package itself has 6 HIGH CVEs in its transitive dependency chain via `bcrypt -> @mapbox/node-pre-gyp -> tar`. Issue #1609 describes CVEs in the esbuild/vite chain used by vitest across multiple plugin packages.

---

## Positive Security Observations

1. **Gastown-bridge CLI bridges** (`bd-bridge.ts`, `gt-bridge.ts`): Use `execFile` (not `exec`), Zod schema validation for all inputs, command allowlists, and shell metacharacter blocking. This is the gold standard for CLI wrapper security in this codebase.

2. **Gastown-bridge sanitizers** (`sanitizers.ts`): Comprehensive output sanitization with size limits, sensitive field redaction, null byte removal, and Zod validation. Follows OWASP guidelines.

3. **Plugin security module** (`@claude-flow/plugins/src/security/index.ts`): Provides `safeJsonParse` (strips `__proto__`), `safePath` (traversal prevention), `validateCommand` (allowlist-based), `constantTimeCompare`, and `createRateLimiter`. This module is well-written but underutilized.

4. **Package name validation** in `manager.ts`: The `VALID_PACKAGE_RE` regex and `validatePackageName` function, combined with `execFile` (array arguments), effectively prevent command injection via the npm install path. This was noted as "S-3" mitigation.

5. **Teammate-bridge input validation**: Uses `SAFE_NAME_PATTERN`, reserved name checks, path traversal validation, and size limits for JSON parsing.

6. **Plugin types system**: The declarative permission model (`PluginPermission`) and trust levels (`TrustLevel`) provide a solid framework -- they just need enforcement.

---

## Prioritized Recommendations

### Immediate (Week 1-2)

1. **Fix registry signature verification** (CRIT-01): Replace the stub with actual Ed25519 verification using the existing `verifyEd25519Signature` function. Block registry use when verification fails and `requireVerification` is true.

2. **Replace `exec()` with `execFile()`** (CRIT-03, HIGH-01): In `gastown-bridge/src/index.ts` line 1040 and all `execSync` calls in `teammate-bridge.ts`.

3. **Add prototype pollution guards to JSON.parse** (HIGH-02, MED-01, MED-02): Replace all bare `JSON.parse()` calls on untrusted data with the security module's `safeJsonParse`. Consider an ESLint rule.

4. **Block plugin installation in demo/fallback mode** (CRIT-04): When the IPFS registry cannot be verified, do not allow `plugins install`.

### Short-Term (Month 1)

5. **Implement checksum verification for IPFS downloads** (HIGH-03): Validate content hash after download.

6. **Enforce permission model** (CRIT-02): Check declared permissions against `allowedPermissions` before plugin initialization. Prompt for `credentials`, `execute`, `privileged`.

7. **Restrict npm install to registry-known plugins** (HIGH-06): Only install plugins that have a verified registry entry.

8. **Sandbox environment variable access** (HIGH-05): Prevent plugins from mutating `process.env` directly.

### Medium-Term (Quarter 1)

9. **Implement plugin code signing** (HIGH-04): Sign published plugins with Ed25519 keys, verify before loading.

10. **Plugin sandboxing** (CRIT-02): Evaluate `isolated-vm`, `vm2`, or Node.js worker threads with restricted permissions for plugin execution.

11. **Remediate transitive CVEs** (Issue #1608, #1609): Update `tar`, `esbuild`, `vite` dependencies across all packages.

12. **Add rate limiting to plugin store APIs** (MED-07): Use the existing `createRateLimiter` utility.

---

## Addendum: Reclassified Finding -- Preinstall Script (Issue #1261)

**Original Classification:** CRITICAL (supply-chain attack)
**Revised Classification:** MEDIUM (transparency gap in migration)

Issue #1261 reported an obfuscated `preinstall` script in `ruflo/package.json` (v3.5.2) that deleted npm cache entries for `claude-flow` from `~/.npm/_cacache/`. An external reporter classified this as a supply-chain attack targeting a competing package.

**Correction:** `ruflo` is the successor/rename of `claude-flow` by the same author. The script was a migration cleanup step intended to clear stale cache entries from the old package name, not an attack on a competitor. The script has since been removed from `@claude-flow/cli`.

**Residual risks (MEDIUM):**
- Obfuscation: a minified one-liner performing recursive `rmSync`/`unlinkSync` is hard to audit
- No disclosure: the migration intent was not documented in README or changelog
- Scope: destructive writes to `~/.npm/_cacache/` (user-level shared resource) are risky regardless of intent

**Recommendation:** For future package renames, document migration cleanup steps transparently and use clear, readable scripts rather than minified one-liners.

---

## Companion Report

A parallel QE fleet security scan covering the full monorepo (2,414 source files, 65+ packages) is available at:

**[`docs/security-scan-qe-fleet-2026-04-28.md`](security-scan-qe-fleet-2026-04-28.md)**

That report found 38 additional findings (4 critical, 9 high, 12 medium, 8 low, 5 info), primarily in the V2 codebase which bypasses the V3 security module. Key additional findings include:
- SEC-001: Command injection via `execSync` with string interpolation in V2 (CVSS 9.8)
- SEC-002: SQL injection via `ATTACH DATABASE` with template literals (CVSS 9.1)
- SEC-003: Unsafe `eval()`/`AsyncFunction` in browser dashboard (CVSS 9.8)
- SEC-007: Unauthenticated WebSocket server with tool execution (CVSS 8.1)

The V3 `@claude-flow/security` package is well-designed but under-adopted -- approximately 60% of the codebase (V2) does not use it.

---

## Scope and Methodology

**Files Examined (primary):**
- `v3/@claude-flow/cli/src/plugins/manager.ts` -- Plugin installation and lifecycle
- `v3/@claude-flow/cli/src/plugins/store/discovery.ts` -- IPFS registry discovery
- `v3/@claude-flow/cli/src/plugins/store/index.ts` -- Plugin store API
- `v3/@claude-flow/cli/src/plugins/store/types.ts` -- Plugin type definitions
- `v3/@claude-flow/cli/src/plugins/store/search.ts` -- Plugin search
- `v3/@claude-flow/cli/src/commands/plugins.ts` -- CLI plugins command
- `v3/@claude-flow/cli/src/transfer/ipfs/client.ts` -- IPFS client
- `v3/@claude-flow/plugins/src/security/index.ts` -- Security module
- `v3/@claude-flow/plugins/src/registry/plugin-registry.ts` -- Plugin registry
- `v3/@claude-flow/plugins/src/registry/enhanced-plugin-registry.ts` -- Enhanced registry
- `v3/@claude-flow/plugins/src/core/base-plugin.ts` -- Base plugin class
- `v3/src/infrastructure/plugins/PluginManager.ts` -- Infrastructure PluginManager
- `v3/src/infrastructure/plugins/Plugin.ts` -- Infrastructure Plugin interface
- `v3/plugins/teammate-plugin/src/teammate-bridge.ts` -- Teammate bridge
- `v3/plugins/gastown-bridge/src/index.ts` -- Gastown bridge plugin
- `v3/plugins/gastown-bridge/src/bridges/bd-bridge.ts` -- Beads CLI bridge
- `v3/plugins/gastown-bridge/src/bridges/gt-bridge.ts` -- Gas Town CLI bridge
- `v3/plugins/gastown-bridge/src/sanitizers.ts` -- Output sanitizers
- `v3/plugins/gastown-bridge/src/validators.ts` -- Input validators
- `v3/plugins/agentic-qe/src/tools/chaos-resilience/chaos-inject.ts` -- Chaos injection
- `v3/plugins/agentic-qe/src/tools/security-compliance/security-scan.ts` -- Security scan
- `v3/plugins/agentic-qe/src/tools/security-compliance/detect-secrets.ts` -- Secret detection
- `v3/plugins/legal-contracts/src/mcp-tools.ts` -- Legal contracts tools
- `v3/plugins/prime-radiant/src/engines/CategoryEngine.ts` -- Category engine

**Approach:**
- Manual source code review of all plugin infrastructure
- Automated pattern matching for dangerous APIs (`eval`, `exec`, `child_process`, `JSON.parse`, `__proto__`, `process.env`)
- Supply chain analysis of the IPFS registry mechanism
- GitHub issue review for known security concerns
- Cross-reference against OWASP Top 10 2021 and CWE Top 25

---

*End of Report*
