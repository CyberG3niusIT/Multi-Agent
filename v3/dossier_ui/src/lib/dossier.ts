export interface DossierNode {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  sources: string[];
}

export interface DossierEdge {
  from: string;
  to: string;
  kind: string;
  source: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface DossierStats {
  nodesByType?: Record<string, number>;
  edgesByKind?: Record<string, number>;
  sourcesUsed?: string[];
  tokensSpent?: number;
  usdSpent?: number;
}

export interface Dossier {
  seed: string;
  seedType: string;
  depth: number;
  truncated: boolean;
  generatedAt?: string;
  nodes: DossierNode[];
  edges: DossierEdge[];
  stats?: DossierStats;
}

export interface DossierIndexEntry {
  slug: string;
  seed: string;
  seedType: string;
  depth: number;
  truncated: boolean;
  generatedAt: string | null;
  nodeCount: number;
  edgeCount: number;
  sources: string[];
}

export async function loadIndex(): Promise<DossierIndexEntry[]> {
  const res = await fetch('/dossiers/index.json');
  if (!res.ok) throw new Error(`index fetch failed: ${res.status}`);
  const json = await res.json();
  return json.dossiers ?? [];
}

export async function loadDossier(slug: string): Promise<Dossier> {
  const safe = slug.replace(/[^a-z0-9-]/gi, '');
  const res = await fetch(`/dossiers/${safe}/${safe}.json`);
  if (!res.ok) throw new Error(`dossier fetch failed: ${res.status}`);
  return res.json();
}

export function buildMermaid(d: Dossier, opts: { maxNodes?: number } = {}): string {
  const max = opts.maxNodes ?? 30;
  const nodes = d.nodes.slice(0, max);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const lines = ['graph TD'];
  for (const n of nodes) {
    const safeId = n.id.replace(/[^a-z0-9_]/gi, '_');
    const label = n.id.replace(/"/g, '\\"');
    lines.push(`  ${safeId}["${label}"]`);
  }
  for (const e of edges) {
    const fromId = e.from.replace(/[^a-z0-9_]/gi, '_');
    const toId = e.to.replace(/[^a-z0-9_]/gi, '_');
    lines.push(`  ${fromId} -->|${e.kind}| ${toId}`);
  }
  return lines.join('\n');
}
