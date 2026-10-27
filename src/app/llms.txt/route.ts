import { renderAgentDocsMarkdown } from '@/lib/agent-docs';

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(renderAgentDocsMarkdown(), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
