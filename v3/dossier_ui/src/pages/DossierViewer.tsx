import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { buildMermaid, loadDossier, type Dossier } from '../lib/dossier';
import EntityTable from '../components/EntityTable';
import MermaidGraph from '../components/MermaidGraph';

export default function DossierViewer() {
  const { slug = '' } = useParams();
  const [d, setD] = useState<Dossier | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setD(null);
    setErr(null);
    loadDossier(slug).then(setD).catch((e) => setErr(String(e)));
  }, [slug]);

  const mermaid = useMemo(() => (d ? buildMermaid(d) : ''), [d]);

  if (err) return (
    <div className="card">
      <strong>FILE PULL ERROR:</strong> {err}<br />
      <Link to="/" className="btn" style={{ marginTop: 12 }}>RETURN TO INDEX</Link>
    </div>
  );
  if (!d) return <div className="card prov">// retrieving dossier <code>{slug}</code> from holding...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
        <Link to="/" className="prov">← back to registry</Link>
        <span className="stamp">{d.truncated ? 'PARTIAL — TRUNCATED' : 'COMPLETE'}</span>
      </div>

      <div className="dossier-folder">
        <div className="prov" style={{ letterSpacing: '0.2em' }}>DOSSIER NO. <strong style={{ color: 'var(--ink)' }}>{slug.toUpperCase()}</strong></div>
        <h1 style={{ marginTop: 4 }}>SUBJECT: <span style={{ color: 'var(--accent)' }}>{d.seed}</span></h1>
        <table style={{ width: 'auto' }}>
          <tbody>
            <tr><th>TYPE</th><td><code>{d.seedType}</code></td></tr>
            <tr><th>DEPTH</th><td>{d.depth}</td></tr>
            <tr><th>NODES</th><td>{d.nodes.length}</td></tr>
            <tr><th>EDGES</th><td>{d.edges.length}</td></tr>
            {d.generatedAt && <tr><th>FILED</th><td>{d.generatedAt}</td></tr>}
            {d.stats?.sourcesUsed && <tr><th>SOURCES</th><td>{d.stats.sourcesUsed.join(', ')}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>// ENTITIES</h2>
      <EntityTable nodes={d.nodes} />

      <h2>// RELATIONSHIP GRAPH</h2>
      <MermaidGraph source={mermaid} />

      <h2>// PROVENANCE FOOTNOTES</h2>
      <ul>
        {d.edges.map((e, i) => (
          <li key={i} className="prov">
            <code>{e.from}</code> → <code>{e.to}</code> ({e.kind}) · source: <code>{e.source}</code> · confidence: <code>{e.confidence ?? '—'}</code>
          </li>
        ))}
      </ul>

      <h2>// METADATA</h2>
      <pre>{JSON.stringify(d.stats ?? {}, null, 2)}</pre>
    </div>
  );
}
