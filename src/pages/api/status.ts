import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const GET: APIRoute = async () => {
  try {
    const { HISTORY_API_TOKEN, BURG_API_TOKEN } = env;
    if (!HISTORY_API_TOKEN || !BURG_API_TOKEN) {
      return new Response(JSON.stringify({ error: "MISSING_SECRETS" }), { status: 200 });
    }

    const burgHeaders = {
      'Authorization': `Bearer ${BURG_API_TOKEN.trim()}`
    };

    const [mpResponse, historyResponse] = await Promise.all([
      fetch("https://mp.gitor.uk/api/mobile/site-status", {
        headers: burgHeaders
      }),
      fetch("https://mp.gitor.uk/history-api/v1/site-status", {
        headers: {
          'Authorization': `Bearer ${HISTORY_API_TOKEN.trim()}`
        }
      })
    ]);

    if (!mpResponse.ok) throw new Error(`MP_STATUS_HTTP_${mpResponse.status}`);
    if (!historyResponse.ok) throw new Error(`HISTORY_HTTP_${historyResponse.status}`);

    const mpStates: any = await mpResponse.json();
    const history: any = await historyResponse.json();

    const dailyRain = Array.isArray(history.daily_rain_14d)
      ? history.daily_rain_14d.map((d: any) => ({
          date: d.date,
          value: d.value
        }))
      : [];

    const dailyIrr = Array.isArray(history.daily_irr_14d)
      ? history.daily_irr_14d.map((d: any) => ({
          date: d.date,
          value: d.value
        }))
      : [];

    const dailyAcute = Array.isArray(history.daily_acute_rain_15d)
      ? history.daily_acute_rain_15d.map((d: any) => ({
          date: d.date,
          minutes: d.minutes,
          percentage: d.percentage
        }))
      : [];

    const hourlyAcute = Array.isArray(history.hourly_acute_rain_24h)
      ? history.hourly_acute_rain_24h.map((d: any) => ({
          start: d.start,
          minutes: d.minutes
        }))
      : [];

    const historicalAcute: any = {};

    for (
      const [year, months]
      of Object.entries(
        history.historical_acute_rain || {}
      )
    ) {
      historicalAcute[year] = {};

      for (
        const [month, value]
        of Object.entries(
          months as Record<string, any>
        )
      ) {
        historicalAcute[year][month] =
          value == null
            ? null
            : {
                minutes: value.minutes,
                percentage: value.percentage
              };
      }
    }

    return new Response(JSON.stringify({
      weather_station: {
        ...mpStates.weather_station,

        temp_min:
          history.weather_extremes?.temp_min
          ?? mpStates.weather_station?.temp_min
          ?? null,

        temp_max:
          history.weather_extremes?.temp_max
          ?? mpStates.weather_station?.temp_max
          ?? null,

        rain_yesterday:
          mpStates.weather_station?.rain_yesterday
          ?? null,

        sunshine_duration:
          mpStates.weather_station?.sunshine_duration
          ?? null
      },

      house_north: {
        temp: mpStates.house_north?.temp ?? null
      },

      house_south: {
        temp: mpStates.house_south?.temp ?? null
      },

      house_east: {
        temp: mpStates.house_east?.temp ?? null
      },

      house_west: {
        temp: mpStates.house_west?.temp ?? null
      },

      greenhouse: {
        temp:
          mpStates.greenhouse?.temp
          ?? null,

        temp_min:
          history.greenhouse_extremes?.temp_min
          ?? null,

        temp_max:
          history.greenhouse_extremes?.temp_max
          ?? null,

        watchdog_active:
          mpStates.watchdog_active
          ?? true,

        heater_energy:
          history.heater_energy
          ?? null
      },

      irrigation: {
        today:
          history.irrigation?.today
          ?? null,

        yesterday:
          history.irrigation?.yesterday
          ?? null,

        is_active:
          history.irrigation?.is_active
          ?? false
      },

      daily_rain_14d:
        dailyRain,

      historical_rain:
        history.historical_rain || {},

      daily_irr_14d:
        dailyIrr,

      historical_irr:
        history.historical_irr || {},

      daily_acute_rain_15d:
        dailyAcute,

      historical_acute_rain:
        historicalAcute,

      hourly_acute_rain_24h:
        hourlyAcute

    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=15'
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({
      error: "FATAL_EDGE_CRASH",
      message: error.message
    }), {
      status: 200
    });
  }
};
