import type { APIRoute } from 'astro';

export const ALL: APIRoute = async ({ params, request }) => {
  const subPath = params.path || '';
  
  // Reconstruct the destination URL pointing to your homelab server
  const url = new URL(request.url);
  const targetUrl = `https://mp.gitor.uk/${subPath}${url.search}`;

  try {
    // Read the incoming body if the request isn't a GET or HEAD
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const bodyContent = hasBody ? await request.blob() : null;

    // Clone and forward the request safely down to the homelab
    const forwardRequest = new Request(targetUrl, {
      method: request.method,
      headers: new Headers(request.headers),
      body: bodyContent,
    });

    // Cloudflare's global fetch executes the request
    const response = await fetch(forwardRequest);
    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*', // Prevents CORS hiccups during local testing
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Homelab HUB proxy unreachable' }), { status: 502 });
  }
};
