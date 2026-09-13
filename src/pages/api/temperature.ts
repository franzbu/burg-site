import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

const round1 = (value: any) => {
  if (
    value === null
    || value === undefined
  ) return null;

  const n=Number(value);

  return Number.isFinite(n)
    ? parseFloat(n.toFixed(1))
    : null;
};

const cleanRows = (rows: any) => {
  if (!Array.isArray(rows)) return [];

  return rows.map((d: any) => ({
    start: d.start,
    mean: round1(d.mean),
    min: round1(d.min),
    max: round1(d.max)
  }));
};

export const GET: APIRoute = async ({
  request
}) => {
  try {
    const {
      HISTORY_API_TOKEN
    } = env;

    if (!HISTORY_API_TOKEN) {
      return new Response(
        JSON.stringify({
          error: "MISSING_SECRETS"
        }),
        {
          status: 200
        }
      );
    }

    const url=new URL(request.url);

    const entityId=
      url.searchParams.get(
        'entity_id'
      );

    if (!entityId) {
      return new Response(
        JSON.stringify({
          error: "Missing entity_id"
        }),
        {
          status: 400
        }
      );
    }

    const upstream=new URL(
      "https://mp.gitor.uk/history-api/v1/temperature"
    );

    upstream.searchParams.set(
      'entity_id',
      entityId
    );

    const res=await fetch(
      upstream.toString(),
      {
        headers: {
          'Authorization':
            `Bearer ${HISTORY_API_TOKEN.trim()}`
        }
      }
    );

    if (!res.ok) {
      throw new Error(
        `HISTORY_HTTP_${res.status}`
      );
    }

    const data:any=
      await res.json();

    return new Response(
      JSON.stringify({
        entity:
          data.entity
          ?? entityId,

        daily:
          cleanRows(data.daily),

        monthly:
          cleanRows(data.monthly),

        hourly:
          cleanRows(data.hourly)
      }),
      {
        headers: {
          'Content-Type':
            'application/json',

          'Cache-Control':
            'public, max-age=300'
        }
      }
    );

  } catch (error:any) {
    return new Response(
      JSON.stringify({
        error: "FATAL_CRASH",
        message: error.message
      }),
      {
        status: 200
      }
    );
  }
};
