import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { LEGACY_ENTITY, METRICS } from '../../lib/burg/metrics';
import { apiError, numberOrNull, record, upstreamTimeout } from '../../lib/burg/http';

const supportedEntities = new Set<string>(Object.values(LEGACY_ENTITY));
const metricFor = (entityId: string) => Object.values(METRICS)
  .find((metric) => metric.aliases.some((alias) => alias === entityId));

function cleanRows(rows: unknown, decimals: number) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    const row = record(value);
    const mean = numberOrNull(row.mean);
    if (typeof row.start !== 'string' || !Number.isFinite(Date.parse(row.start)) || mean === null) return [];
    const round = (value: unknown) => {
      const number = numberOrNull(value);
      return number === null ? null : Number(number.toFixed(decimals));
    };
    return [{ start: row.start, mean: round(mean), min: round(row.min), max: round(row.max) }];
  });
}

export const GET: APIRoute = async ({ request }) => {
  const entityId = new URL(request.url).searchParams.get('entity_id');
  if (!entityId || !supportedEntities.has(entityId)) return apiError('INVALID_ENTITY', 400);
  const token = env.HISTORY_API_TOKEN?.trim();
  if (!token) return apiError('SERVICE_UNAVAILABLE', 503);

  try {
    const upstream = new URL('https://mp.gitor.uk/ha-history-api/v1/temperature');
    upstream.searchParams.set('entity_id', entityId);
    const response = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}` },
      signal: upstreamTimeout(),
    });
    if (!response.ok) throw new Error(`History upstream returned ${response.status}`);
    const data = record(await response.json());
    if (data.error || !Array.isArray(data.daily) || !Array.isArray(data.monthly) || !Array.isArray(data.hourly)) {
      throw new Error('Invalid history response');
    }
    const decimals = metricFor(entityId)?.decimals ?? 1;
    return Response.json({
      entity: entityId,
      daily: cleanRows(data.daily, decimals),
      monthly: cleanRows(data.monthly, decimals),
      hourly: cleanRows(data.hourly, decimals),
    }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch {
    return apiError('HISTORY_UNAVAILABLE', 502);
  }
};
