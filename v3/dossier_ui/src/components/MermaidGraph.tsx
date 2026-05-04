import { useEffect, useRef, useState } from 'react';

export default function MermaidGraph({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            background: '#0f1410',
            primaryColor: '#141a14',
            primaryTextColor: '#c8c8b8',
            primaryBorderColor: '#ffb000',
            lineColor: '#7a7a6e',
            fontFamily: 'IBM Plex Mono, monospace',
          },
        });
        const id = `m_${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  if (err) return <pre className="mermaid-wrap">// graph render failed: {err}</pre>;
  return <div className="mermaid-wrap" ref={ref} />;
}
