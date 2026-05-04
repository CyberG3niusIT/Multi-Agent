import { Link } from 'react-router-dom';

export default function About() {
  return (
    <div>
      <h1>BRIEFING <span className="sub">/ DOSSIER OPERATIONAL DOCTRINE</span></h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>// MISSION</h2>
        <p>
          <strong>dossier.ruv.io</strong> is the classified-document viewer for the <code>ruflo-goals</code>
          plugin's <code>dossier-collect</code> skill (ADR-099). Each dossier is the output of a
          recursive parallel multi-source investigation against a seed entity — a username, ADR id,
          file path, code symbol, URL, or free-text concept.
        </p>
        <p>
          Sources include hybrid memory search, knowledge-graph traversal, AgentDB pattern recall,
          web search/fetch, codebase grep, ADR index, and git intelligence — all batched in
          parallel per round, then re-seeded with discovered entities up to a depth bound.
        </p>
      </div>

      <h2>// REFERENCED DECISIONS</h2>
      <ul>
        <li><a href="https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-099-dossier-investigator-recursive-parallel-research.md" target="_blank" rel="noreferrer">ADR-099 — Dossier-Investigator agent + skill</a></li>
        <li><code>ADR-104</code> — this UI on Cloud Run (in this branch)</li>
        <li><a href="https://github.com/soxoj/maigret" target="_blank" rel="noreferrer">soxoj/maigret</a> — pattern reference (parallel + recursive + structured dossier)</li>
      </ul>

      <h2>// SIBLING SERVICE</h2>
      <p>
        For goal-oriented planning, see <a href="https://goal.ruv.io" target="_blank" rel="noreferrer">goal.ruv.io</a>.
        The two services share a Cloud Run security stack (CORS allowlist, X-RuFlo-Token, per-IP rate-limit)
        but deploy independently.
      </p>

      <Link to="/" className="btn">RETURN TO REGISTRY</Link>
    </div>
  );
}
