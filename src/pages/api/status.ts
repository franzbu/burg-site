import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const GET: APIRoute = async () => {
  try {
    const { HA_TOKEN, CF_CLIENT_ID, CF_CLIENT_SECRET } = env;
    if (!HA_TOKEN || !CF_CLIENT_ID || !CF_CLIENT_SECRET) return new Response(JSON.stringify({ error: "MISSING_SECRETS" }), { status: 200 });

    const HA_BASE = "https://ha.gitor.uk/api";
    const MP_URL = "https://mp.gitor.uk/status";
    const TOTAL_RAIN_ID = "sensor.weather_sensor_plus_garten_total_rain";

    const [haResponse, mpResponse] = await Promise.all([
      fetch(`${HA_BASE}/states`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } }),
      fetch(MP_URL, { headers: { 'CF-Access-Client-Id': CF_CLIENT_ID.trim(), 'CF-Access-Client-Secret': CF_CLIENT_SECRET.trim() } })
    ]);

    const safeParse = async (res: Response) => { try { return JSON.parse((await res.text()).trim()); } catch (e) { return null; } };
    const haStates = await safeParse(haResponse) || [];
    const mpStates = await safeParse(mpResponse) || {};

    const getHAState = (id: string) => {
      const entity = haStates.find((s: any) => s.entity_id === id);
      return (entity && !isNaN(parseFloat(entity.state))) ? parseFloat(entity.state) : null;
    };

    const now = new Date().toISOString();
    const dayStart = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date("2023-12-01T00:00:00Z").toISOString();
    const d = new Date();
    const mtdStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString();

    const fetchRainLTS = (): Promise<any> => {
        return new Promise((resolve) => {
            const ws = new WebSocket("wss://ha.gitor.uk/api/websocket");
            let dailyData: any = null, monthlyData: any = null, mtdData: any = null;
            const timeout = setTimeout(() => { ws.close(); resolve({ dailyData: {}, monthlyData: {}, mtdData: {} }); }, 8000);

            const checkDone = () => {
                if (dailyData !== null && monthlyData !== null && mtdData !== null) {
                    clearTimeout(timeout); ws.close();
                    resolve({ dailyData, monthlyData, mtdData });
                }
            };

            ws.addEventListener("message", (event) => {
                const msg = JSON.parse(event.data as string);
                if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN.trim() }));
                else if (msg.type === "auth_ok") {
                    ws.send(JSON.stringify({ id: 1, type: "recorder/statistics_during_period", start_time: dayStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "day", types: ["sum"] }));
                    ws.send(JSON.stringify({ id: 2, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "month", types: ["sum"] }));
                    ws.send(JSON.stringify({ id: 3, type: "recorder/statistics_during_period", start_time: mtdStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "day", types: ["sum"] }));
                } else if (msg.type === "result") {
                    if (msg.id === 1) dailyData = msg.result || {};
                    if (msg.id === 2) monthlyData = msg.result || {};
                    if (msg.id === 3) mtdData = msg.result || {};
                    checkDone();
                }
            });
            ws.addEventListener("error", () => { clearTimeout(timeout); resolve({ dailyData: {}, monthlyData: {}, mtdData: {} }); });
        });
    };

    const { dailyData, monthlyData, mtdData } = await fetchRainLTS();
    const OFFSET_MS = 2 * 60 * 60 * 1000;

    const extractDiffs = (dataBlock: any) => {
        const stats = dataBlock[TOTAL_RAIN_ID] || [];
        const result: { start: string, val: number }[] = [];
        for (let i = 1; i < stats.length; i++) {
            const prev = stats[i - 1].sum || 0;
            const curr = stats[i].sum || 0;
            const localDate = new Date(new Date(stats[i].start).getTime() + OFFSET_MS);
            result.push({ start: localDate.toISOString(), val: parseFloat(Math.max(0, curr - prev).toFixed(1)) });
        }
        return result;
    };

    const dailyRain = extractDiffs(dailyData).slice(-15);
    let monthlyRain = extractDiffs(monthlyData).map((m: any) => {
        const date = new Date(m.start);
        date.setUTCDate(1); 
        return { start: date.toISOString(), val: m.val };
    });
    
    const currentMonthDays = extractDiffs(mtdData);
    if (currentMonthDays.length > 0) {
        const totalSum = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0);
        const currentMonthStartISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
        const existingIndex = monthlyRain.findIndex((m: any) => m.start.startsWith(currentMonthStartISO.substring(0, 7)));
        if (existingIndex !== -1) monthlyRain[existingIndex].val = parseFloat(totalSum.toFixed(1));
        else monthlyRain.push({ start: currentMonthStartISO, val: parseFloat(totalSum.toFixed(1)) });
    }

    const formattedDaily14d = dailyRain.map((d: any) => {
        const dateObj = new Date(d.start);
        return { date: `${dateObj.getUTCDate().toString().padStart(2,'0')}.${(dateObj.getUTCMonth()+1).toString().padStart(2,'0')}`, value: d.val };
    });

    const historicalRainArchive: any = {};
    monthlyRain.forEach((m: any) => {
        const dateObj = new Date(m.start);
        const y = dateObj.getUTCFullYear();
        const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        if (!historicalRainArchive[y]) historicalRainArchive[y] = { 'Januar': null, 'Februar': null, 'März': null, 'April': null, 'Mai': null, 'Juni': null, 'Juli': null, 'August': null, 'September': null, 'Oktober': null, 'November': null, 'Dezember': null };
        historicalRainArchive[y][months[dateObj.getUTCMonth()]] = m.val;
    });

    return new Response(JSON.stringify({
      weather_station: {
        ...mpStates.weather_station,
        rain_yesterday: mpStates.weather_station?.rain_yesterday ?? getHAState('sensor.weather_sensor_plus_garten_yesterday_s_rain'),
        sunshine_duration: mpStates.weather_station?.sunshine_duration ?? getHAState('sensor.weather_sensor_plus_garten_today_s_sunshine_duration')
      },
      house_north: { temp: mpStates.house_north?.temp ?? null }, 
      house_south: { temp: mpStates.house_south?.temp ?? null }, 
      house_east: { temp: mpStates.house_east?.temp ?? null }, 
      house_west: { temp: mpStates.house_west?.temp ?? null }, 
      greenhouse: { 
        temp: mpStates.greenhouse?.temp ?? null,
        watchdog_active: mpStates.watchdog_active ?? true,
        heater_energy: getHAState('sensor.switching_and_measuring_cable_outdoor_energy_counter')
      },
      daily_rain_14d: formattedDaily14d, historical_rain: historicalRainArchive
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_EDGE_CRASH", message: error.message }), { status: 200 });
  }
};