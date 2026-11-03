import { handle } from '@/lib/api/http';
import { runDaily } from '@/lib/inventory/daily-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The daily inventory check (SPEC §14.11): see `runDaily` for who may read it and who may post it. */
export const GET = handle((req) => runDaily(req));
export const POST = handle((req) => runDaily(req));
