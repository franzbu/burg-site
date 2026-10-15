import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiError, upstreamTimeout } from '../../lib/burg/http';

// Authentication is still required at the edge before enabling this route publicly.
export const DELETE: APIRoute = async ({ request }) => {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return apiError('FORBIDDEN_ORIGIN', 403);
  const url = new URL(request.url);
  const filename = url.searchParams.get('file');
  const prefix = url.searchParams.get('prefix');
  const allowedPrefixes = ['mountain_', 'entrance_'];
  if ((filename && prefix) || (!filename && !prefix)) return apiError('INVALID_TARGET', 400);
  if (filename && !/^(mountain_|entrance_)[A-Za-z0-9_.-]+\.(webp|jpe?g|png)$/i.test(filename)) {
    return apiError('INVALID_FILENAME', 400);
  }
  if (prefix && !allowedPrefixes.includes(prefix)) return apiError('INVALID_PREFIX', 400);
  const secret = env.UPLOAD_SECRET?.trim();
  if (!secret) return apiError('SERVICE_UNAVAILABLE', 503);
  const target = new URL('https://burg-upload-proxy.csaa6335.workers.dev');
  target.pathname = filename ? `/${encodeURIComponent(filename)}` : '/delete-all';
  if (prefix) target.searchParams.set('prefix', prefix);
  try {
    const response = await fetch(target, {
      method: 'DELETE', headers: { Authorization: `Bearer ${secret}` }, signal: upstreamTimeout(),
    });
    if (!response.ok) return apiError('DELETE_FAILED', 502);
    return Response.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError('DELETE_UNAVAILABLE', 502);
  }
};
