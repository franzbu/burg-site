export const upstreamTimeout = () => AbortSignal.timeout(10_000);

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function booleanOrNull(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 'on' || value === 1) return true;
  if (value === false || value === 'false' || value === 'off' || value === 0) return false;
  return null;
}

export function apiError(error: string, status: number): Response {
  return Response.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
