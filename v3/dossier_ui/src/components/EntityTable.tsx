import type { DossierNode } from '../lib/dossier';

export default function EntityTable({ nodes }: { nodes: DossierNode[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Entity</th>
          <th>Type</th>
          <th>Key Attrs</th>
          <th>Sources</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <tr key={n.id}>
            <td><code>{n.id}</code></td>
            <td><span className="stamp amber">{n.type}</span></td>
            <td>
              {n.attrs ? (
                <span className="prov">
                  {Object.entries(n.attrs).slice(0, 3).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 8 }}>
                      <code>{k}</code>={String(v).slice(0, 40)}
                    </span>
                  ))}
                </span>
              ) : '—'}
            </td>
            <td>{n.sources.map((s, i) => <code key={i} style={{ marginRight: 6 }}>{s}</code>)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
