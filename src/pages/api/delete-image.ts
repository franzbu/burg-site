import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { UPLOAD_SECRET } = env;
    if (!UPLOAD_SECRET) {
      return new Response(JSON.stringify({ error: "Missing secret in vault" }), { status: 500 });
    }

    const url = new URL(request.url);
    const filename = url.searchParams.get('file');
    const prefix = url.searchParams.get('prefix'); // ADDED: Extracts prefix securely

    const workerUrl = "https://burg-upload-proxy.csaa6335.workers.dev";
    
    // ADDED: Appends the prefix to the Worker URL if a delete-all is triggered
    const targetUrl = filename 
        ? `${workerUrl}/${filename}` 
        : (prefix ? `${workerUrl}/delete-all?prefix=${prefix}` : `${workerUrl}/delete-all`);

    const response = await fetch(targetUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${UPLOAD_SECRET}`
      }
    });

    if (response.ok) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } else {
        return new Response(JSON.stringify({ error: "Worker rejected the request" }), { status: response.status });
    }

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};