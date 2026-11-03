import { handle } from '@/lib/api/http';
import { runDaily } from '@/lib/inventory/daily-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The cron's path: the daily check with `notify` implied (Vercel cron paths carry no query string). Same rules as `?notify=1`. */
export const GET = handle((req) => runDaily(req, { notify: true }));
export const POST = handle((req) => runDaily(req, { notify: true }));
