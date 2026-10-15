import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiError, booleanOrNull, numberOrNull, record, upstreamTimeout } from '../../lib/burg/http';

function numericArchive(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).map(([year, months]) => [
    year, Object.fromEntries(Object.entries(record(months)).map(([month, value]) => [month, numberOrNull(value)])),
  ]));
}

function numericRows(value: unknown, fields: string[], dateField: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value) => {
    const row = record(value);
    if (typeof row[dateField] !== 'string') return [];
    const numbers = Object.fromEntries(fields.map((field) => [field, numberOrNull(row[field])]));
    if (Object.values(numbers).some((value) => value === null)) return [];
    return [{ [dateField]: row[dateField], ...numbers }];
  });
}

export const GET: APIRoute = async () => {
  const token = env.HISTORY_API_TOKEN?.trim();
  if (!token) return apiError('SERVICE_UNAVAILABLE', 503);
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [liveResponse, historyResponse] = await Promise.all([
      fetch('https://mp.gitor.uk/ha-history-api/v1/live-status', { headers, signal: upstreamTimeout() }),
      fetch('https://mp.gitor.uk/ha-history-api/v1/site-status', { headers, signal: upstreamTimeout() }),
    ]);
    if (!liveResponse.ok || !historyResponse.ok) throw new Error('Status upstream unavailable');
    const live = record(await liveResponse.json());
    const history = record(await historyResponse.json());
    if (live.error || history.error || !Object.keys(live).length || !Object.keys(history).length) {
      throw new Error('Invalid status response');
    }
    const weather = record(live.weather_station);
    const extremes = record(history.weather_extremes);
    const greenhouse = record(live.greenhouse);
    const greenhouseExtremes = record(history.greenhouse_extremes);
    const irrigation = record(history.irrigation);
    const historicalAcute = Object.fromEntries(Object.entries(record(history.historical_acute_rain)).map(([year, months]) => [
      year, Object.fromEntries(Object.entries(record(months)).map(([month, value]) => {
        const stats = record(value);
        const minutes = numberOrNull(stats.minutes);
        const percentage = numberOrNull(stats.percentage);
        return [month, minutes === null || percentage === null ? null : { minutes, percentage }];
      })),
    ]));

    return Response.json({
      weather_station: {
        ...Object.fromEntries(['temp', 'hum', 'wind', 'wind_direction', 'lux', 'rain_today', 'rain_yesterday', 'sunshine_duration']
          .map((field) => [field, numberOrNull(weather[field])])),
        temp_min: numberOrNull(extremes.temp_min) ?? numberOrNull(weather.temp_min),
        temp_max: numberOrNull(extremes.temp_max) ?? numberOrNull(weather.temp_max),
        is_raining: booleanOrNull(weather.is_raining),
        is_stormy: booleanOrNull(weather.is_stormy),
      },
      ...Object.fromEntries(['north', 'south', 'east', 'west'].map((direction) => [
        `house_${direction}`, { temp: numberOrNull(record(live[`house_${direction}`]).temp) },
      ])),
      greenhouse: {
        temp: numberOrNull(greenhouse.temp),
        temp_min: numberOrNull(greenhouseExtremes.temp_min),
        temp_max: numberOrNull(greenhouseExtremes.temp_max),
        watchdog_active: booleanOrNull(live.watchdog_active),
        heater_energy: numberOrNull(history.heater_energy),
        heater_energy_today: numberOrNull(history.heater_energy_today),
      },
      irrigation: {
        today: numberOrNull(irrigation.today),
        yesterday: numberOrNull(irrigation.yesterday),
        is_active: booleanOrNull(irrigation.is_active),
      },
      daily_rain_14d: numericRows(history.daily_rain_14d, ['value'], 'date'),
      historical_rain: numericArchive(history.historical_rain),
      daily_irr_14d: numericRows(history.daily_irr_14d, ['value'], 'date'),
      historical_irr: numericArchive(history.historical_irr),
      daily_acute_rain_15d: numericRows(history.daily_acute_rain_15d, ['minutes', 'percentage'], 'date'),
      historical_acute_rain: historicalAcute,
      hourly_acute_rain_24h: numericRows(history.hourly_acute_rain_24h, ['minutes'], 'start'),
    }, { headers: { 'Cache-Control': 'public, max-age=15' } });
  } catch {
    return apiError('STATUS_UNAVAILABLE', 502);
  }
};
