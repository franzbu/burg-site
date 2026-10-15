import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (response.headers.get('Content-Type')?.includes('text/html')) {
    const vary = response.headers.get('Vary');
    response.headers.set('Vary', vary ? `${vary}, Accept-Language` : 'Accept-Language');
    response.headers.set('Cache-Control', 'no-cache');
  }
  return response;
});
