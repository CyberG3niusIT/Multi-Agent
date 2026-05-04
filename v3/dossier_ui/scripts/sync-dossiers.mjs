#!/usr/bin/env node
/**
 * Sync v3/docs/examples/dossiers/* → v3/dossier_ui/public/dossiers/ at
 * dev / build time. Generates an index.json catalog the SPA fetches at
 * load.
 *
 * Run via the package.json `predev` / `prebuild` hooks.
 */
import { mkdir, readdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'docs', 'examples', 'dossiers');
const DST = resolve(HERE, '..', 'public', 'dossiers');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  if (!(await exists(SRC))) {
    console.error(`[sync-dossiers] source not found: ${SRC}`);
    process.exit(1);
  }
  await mkdir(DST, { recursive: true });

  const entries = await readdir(SRC, { withFileTypes: true });
  const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const index = [];

  for (const slug of slugs) {
    const srcDir = resolve(SRC, slug);
    const dstDir = resolve(DST, slug);
    await mkdir(dstDir, { recursive: true });

    const files = await readdir(srcDir);
    for (const f of files) {
      await copyFile(resolve(srcDir, f), resolve(dstDir, f));
    }

    // Read JSON for index metadata
    const jsonName = files.find((f) => f.endsWith('.json'));
    if (jsonName) {
      const json = JSON.parse(await readFile(resolve(srcDir, jsonName), 'utf-8'));
      index.push({
        slug,
        seed: json.seed ?? slug,
        seedType: json.seedType ?? 'unknown',
        depth: json.depth ?? 0,
        truncated: json.truncated ?? false,
        generatedAt: json.generatedAt ?? null,
        nodeCount: (json.nodes ?? []).length,
        edgeCount: (json.edges ?? []).length,
        sources: json.stats?.sourcesUsed ?? [],
      });
    }
  }

  index.sort((a, b) => a.slug.localeCompare(b.slug));
  await writeFile(resolve(DST, 'index.json'), JSON.stringify({ dossiers: index }, null, 2));

  console.log(`[sync-dossiers] synced ${slugs.length} dossiers → public/dossiers/`);
  console.log(`[sync-dossiers] slugs: ${slugs.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
