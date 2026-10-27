/** Regenerates docs/AGENTS.md from src/lib/agent-docs.ts (the same content as /agents and /llms.txt). */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderAgentDocsMarkdown } from '../src/lib/agent-docs';

const target = path.join(process.cwd(), 'docs', 'AGENTS.md');
writeFileSync(target, renderAgentDocsMarkdown());
process.stdout.write(`wrote ${target}\n`);
