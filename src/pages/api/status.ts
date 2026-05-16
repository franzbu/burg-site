import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async () => {
  const ESP_URL = 'https://mp.gitor.uk/status';
  const HA_BASE = 'https://ha.gitor.uk'; 
  const STATISTIC_ID = 'sensor.weather_station_rain_total'; 
  const START_TIME = '2026-01-01T00:00:00Z';
  const HA_URL = `${HA_BASE}/api/statistics/during_period?start_time=${START_TIME}&period=monthly&statistic_ids=${STATISTIC_ID}`;

  const haToken = env.HA_TOKEN;

  try {
    const [espPromise, haPromise] = await Promise.all([
      fetch(ESP_URL),
      fetch(HA_URL, {
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json'
        }
      })
    ]);

    if (!espPromise.ok) {
      return new Response(JSON.stringify({ error: `ESP status endpoint returned status ${espPromise.status}` }), { 
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const espData = await espPromise.json();
    const haData = haPromise.ok ? await haPromise.json() : null;

    const monthlyRainfall: { [key: string]: number } = {};
    const deMonths = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    if (haData && haData[STATISTIC_ID]) {
      const stats = haData[STATISTIC_ID];
      stats.forEach((stat: any) => {
        const date = new Date(stat.start);
        const monthIndex = date.getMonth();
        const monthName = deMonths[monthIndex];
        monthlyRainfall[monthName] = (monthlyRainfall[monthName] || 0) + (stat.change || 0);
      });
    }

    espData.historical_rain = monthlyRainfall;

    return new Response(JSON.stringify(espData), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Edge data stitching pipeline failure' }), { 
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};