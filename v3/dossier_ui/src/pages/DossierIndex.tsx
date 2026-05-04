import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadIndex, type DossierIndexEntry } from '../lib/dossier';

export default function DossierIndex() {
  const [entries, setEntries] = useState<DossierIndexEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex().then(setEntries).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <div className="banner">
        <span className="live" />
        <strong>OPERATIONAL FILES</strong>
        <span className="prov" style={{ marginLeft: 12 }}>
          Recursive parallel multi-source investigations · ADR-099 / ADR-104 · classification: <span className="stamp">UNCLASSIFIED — DEMO</span>
        </span>
      </div>

      <h1>DOSSIER REGISTRY <span className="sub">/ FILES IN HOLDING</span></h1>

      {error && <div className="card"><strong>ERR:</strong> {error}</div>}
      {!error && entries.length === 0 && <div className="card prov">// no dossiers indexed. run `npm run dev` after `node scripts/sync-dossiers.mjs`.</div>}

      <div className="dossier-list">
        {entries.map((e) => (
          <Link key={e.slug} to={`/d/${e.slug}`} className="dossier-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="prov">DOSSIER NO.</div>
                <h3>{e.slug.toUpperCase()}</h3>
              </div>
              <span className="stamp">{e.truncated ? 'PARTIAL' : 'COMPLETE'}</span>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              <div>SUBJECT &nbsp;: <code>{e.seed}</code></div>
              <div>TYPE &nbsp;&nbsp;&nbsp;&nbsp;: <span className="seedtype">{e.seedType}</span></div>
              <div>DEPTH &nbsp;&nbsp;&nbsp;: {e.depth}</div>
              <div>NODES &nbsp;&nbsp;&nbsp;: {e.nodeCount} &nbsp;·&nbsp; EDGES: {e.edgeCount}</div>
              <div>SOURCES&nbsp;: {e.sources.join(', ') || '—'}</div>
              {e.generatedAt && <div>FILED &nbsp;&nbsp;&nbsp;: {e.generatedAt.slice(0, 10)}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
