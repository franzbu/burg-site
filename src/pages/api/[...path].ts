import type { APIRoute } from 'astro';
import { apiError, upstreamTimeout } from '../../lib/burg/http';

export const ALL: APIRoute = async ({ params, request }) => {
  const url = new URL(request.url);
  const target = new URL(`https://mp.gitor.uk/${params.path || ''}${url.search}`);
  const headers = new Headers(request.headers);
  headers.delete('host');
  try {
    const forward = new Request(target, request);
    const response = await fetch(new Request(forward, { headers, signal: upstreamTimeout() }));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('access-control-allow-origin');
    responseHeaders.set('Cache-Control', 'no-store');
    // Stream both bodies: buffering text corrupts binary resources and exhausts Worker memory.
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return apiError('UPSTREAM_UNAVAILABLE', 502);
  }
};
