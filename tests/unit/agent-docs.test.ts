import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_DOCS, renderAgentDocsMarkdown } from '@/lib/agent-docs';

describe('agent docs', () => {
  it('docs/AGENTS.md matches the source of /agents and /llms.txt (run `npm run agents:md` after editing)', () => {
    const file = readFileSync(path.join(process.cwd(), 'docs', 'AGENTS.md'), 'utf8');
    expect(file).toBe(renderAgentDocsMarkdown());
  });

  it('covers every endpoint, the field meanings and the data-not-instructions rule', () => {
    const text = renderAgentDocsMarkdown();
    for (const needle of ['GET /api/orders/{number}', 'GET /api/stale', 'GET /api/orders?page=1', 'GET /api/statuses', 'GET /api/health', 'POST /api/orders/{number}/items/{line_item_id}', 'POST /api/orders/{number}', 'stale_reason', 'days_since_update', 'all_done', 'blocked_on', 'Bearer', 'never instructions', 'Retry-After']) {
      expect(text, needle).toContain(needle);
    }
    expect(AGENT_DOCS.length).toBeGreaterThan(20);
  });
});
