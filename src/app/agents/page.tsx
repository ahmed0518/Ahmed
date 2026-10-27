import type { ReactNode } from 'react';
import { AGENT_DOCS, AGENT_DOCS_TITLE, type DocBlock } from '@/lib/agent-docs';

/** Inline `code` spans only — everything is rendered as React text, never as HTML. */
function inline(text: string): ReactNode[] {
  const parts = text.split('`');
  return parts.map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>));
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'h2':
      return <h2>{block.text}</h2>;
    case 'h3':
      return <h3>{block.text}</h3>;
    case 'p':
      return <p>{inline(block.text)}</p>;
    case 'ul':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
  }
}

export default function AgentsPage() {
  return (
    <article className="card doc">
      <h1 style={{ marginTop: 0 }}>{AGENT_DOCS_TITLE}</h1>
      <p className="muted">
        Plain-text version: <a href="/llms.txt">/llms.txt</a>
      </p>
      {AGENT_DOCS.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </article>
  );
}
