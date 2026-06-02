import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { HA_TOKEN } = env;
    if (!HA_TOKEN) return new Response(JSON.stringify({ error: "MISSING_SECRETS" }), { status: 200 });

    const url = new URL(request.url);
    const entityId = url.searchParams.get('entity_id');
    if (!entityId) return new Response(JSON.stringify({ error: "Missing entity_id" }), { status: 400 });

    const isCumulative = entityId.includes('sunshine') || entityId.includes('energy') || entityId.includes('rain');
    
    // --- STITCH SPLIT-BRAIN SENSORS ---
    let queryIds = [entityId];
    if (entityId === 'sensor.temperature_and_humidity_sensor_outdoor_west_temperature' || 
        entityId === 'sensor.temperature_and_humidity_sensor_outdoor_house_west_temperature') {
        queryIds = [
            'sensor.temperature_and_humidity_sensor_outdoor_house_west_temperature', 
            'sensor.temperature_and_humidity_sensor_outdoor_west_temperature'
        ];
    }

    let statType = "mean";
    let statTypes = ["mean", "min", "max"];
    if (entityId.includes('energy')) { statType = "state"; statTypes = ["state"]; }
    else if (isCumulative) { statType = "sum"; statTypes = ["sum"]; }

    const OFFSET_MS = 2 * 60 * 60 * 1000; // Italy CEST offset
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    // Fetch ALL daily data to completely bypass HA's buggy monthly bucket finalization drops
    const historyStart = new Date("2023-12-01T00:00:00Z").toISOString();
    const hourStart = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

    const fetchLTSViaWebSocket = (): Promise<any> => {
        return new Promise(async (resolve, reject) => {
            try {
                const wsResponse = await fetch("https://ha.gitor.uk/api/websocket", {
                    headers: { "Upgrade": "websocket", "Connection": "Upgrade" }
                });
                
                const ws = wsResponse.webSocket;
                if (!ws) { reject(new Error("No websocket")); return; }
                
                ws.accept();

                let dailyData: any = null, hourlyData: any = null;
                const timeout = setTimeout(() => { ws.close(); reject(new Error("WebSocket timeout")); }, 8000);

                const checkDone = () => {
                    if (dailyData !== null && hourlyData !== null) {
                        clearTimeout(timeout); ws.close();
                        resolve({ dailyData, hourlyData });
                    }
                };

                ws.addEventListener("message", (event) => {
                    const msg = JSON.parse(event.data as string);
                    if (msg.type === "auth_required") {
                        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN.trim() }));
                    } else if (msg.type === "auth_ok") {
                        ws.send(JSON.stringify({ id: 1, type: "recorder/statistics_during_period", start_time: historyStart, end_time: now, statistic_ids: queryIds, period: "day", types: statTypes }));
                        ws.send(JSON.stringify({ id: 2, type: "recorder/statistics_during_period", start_time: hourStart, end_time: now, statistic_ids: queryIds, period: "5minute", types: statTypes }));
                    } else if (msg.type === "result") {
                        if (msg.id === 1) dailyData = msg.result || {};
                        if (msg.id === 2) hourlyData = msg.result || {};
                        checkDone();
                    }
                });
                ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS error")); });
            } catch (e) {
                reject(e);
            }
        });
    };

    const { dailyData, hourlyData } = await fetchLTSViaWebSocket();

    let combinedStats: any[] = [];
    for (const id of queryIds) {
        if (dailyData[id]) combinedStats = combinedStats.concat(dailyData[id]);
    }
    const uniqueMap = new Map();
    for (const s of combinedStats) uniqueMap.set(s.start, s);
    const stats = Array.from(uniqueMap.values()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // --- ROCK-SOLID DAILY & MONTHLY AGGREGATION ---
    let processedDaily: any[] = [];
    if (isCumulative) {
        for (let i = 1; i < stats.length; i++) {
            const prev = stats[i - 1][statType] !== undefined && stats[i - 1][statType] !== null ? stats[i - 1][statType] : 0;
            const curr = stats[i][statType] !== undefined && stats[i][statType] !== null ? stats[i][statType] : 0;
            const diff = Math.max(0, curr - prev);
            const localDate = new Date(new Date(stats[i].start).getTime() + OFFSET_MS);
            processedDaily.push({ start: localDate, val: diff, min: diff, max: diff });
        }
    } else {
        processedDaily = stats.map((s: any) => {
            const localDate = new Date(new Date(s.start).getTime() + OFFSET_MS);
            return { 
                start: localDate, 
                val: s.mean !== undefined && s.mean !== null ? s.mean : null, 
                min: s.min !== undefined && s.min !== null ? s.min : null, 
                max: s.max !== undefined && s.max !== null ? s.max : null 
            };
        });
    }

    const daily = processedDaily.slice(-15).map(d => ({
        start: d.start.toISOString(),
        mean: d.val !== null ? parseFloat(d.val.toFixed(1)) : null,
        min: d.min !== null ? parseFloat(d.min.toFixed(1)) : null,
        max: d.max !== null ? parseFloat(d.max.toFixed(1)) : null
    }));

    const monthlyMap = new Map();
    processedDaily.forEach(d => {
        const y = d.start.getUTCFullYear();
        const m = d.start.getUTCMonth();
        const key = `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`;

        if (!monthlyMap.has(key)) {
            monthlyMap.set(key, { sum: 0, count: 0, min: null, max: null });
        }
        const bucket = monthlyMap.get(key);

        if (d.val !== null) {
            bucket.sum += d.val;
            bucket.count += 1;
        }
        if (d.min !== null) bucket.min = bucket.min === null ? d.min : Math.min(bucket.min, d.min);
        if (d.max !== null) bucket.max = bucket.max === null ? d.max : Math.max(bucket.max, d.max);
    });

    const monthly = Array.from(monthlyMap.entries()).map(([key, bucket]) => {
        let mean = 0;
        if (isCumulative) {
            mean = bucket.sum;
        } else {
            mean = bucket.count > 0 ? bucket.sum / bucket.count : 0;
        }
        return {
            start: key,
            mean: parseFloat(mean.toFixed(1)),
            min: bucket.min !== null ? parseFloat(bucket.min.toFixed(1)) : null,
            max: bucket.max !== null ? parseFloat(bucket.max.toFixed(1)) : null
        };
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // --- HOURLY PROCESSING ---
    let combinedHourly: any[] = [];
    for (const id of queryIds) {
        if (hourlyData[id]) combinedHourly = combinedHourly.concat(hourlyData[id]);
    }
    const uniqueHMap = new Map();
    for (const s of combinedHourly) uniqueHMap.set(s.start, s);
    let statsH = Array.from(uniqueHMap.values()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    let finalHourly: any[] = [];
    const twentyFourHoursAgo = nowMs - (24 * 60 * 60 * 1000);

    if (isCumulative) {
        for (let i = 1; i < statsH.length; i++) {
            // FIX: Accidentally referenced 'stats' (daily array) instead of 'statsH' (hourly array) here, causing out-of-bounds TypeError crashes on new sensors
            const prev = statsH[i - 1][statType] !== undefined && statsH[i - 1][statType] !== null ? statsH[i - 1][statType] : 0;
            const curr = statsH[i][statType] !== undefined && statsH[i][statType] !== null ? statsH[i][statType] : 0;
            const diff = Math.max(0, curr - prev);
            const diffFloat = parseFloat(diff.toFixed(1));
            if (new Date(statsH[i].start).getTime() >= twentyFourHoursAgo) {
                finalHourly.push({ start: statsH[i].start, mean: diffFloat, min: diffFloat, max: diffFloat });
            }
        }
    } else {
        let parsedH = statsH.map((s: any) => ({
            start: s.start,
            mean: s.mean !== undefined && s.mean !== null ? s.mean : null,
            min: s.min !== undefined && s.min !== null ? s.min : null,
            max: s.max !== undefined && s.max !== null ? s.max : null
        }));

        for (let i = 0; i < parsedH.length; i++) {
            if (parsedH[i].mean === null) {
                let prevIdx = i - 1;
                while (prevIdx >= 0 && parsedH[prevIdx].mean === null) prevIdx--;
                let nextIdx = i + 1;
                while (nextIdx < parsedH.length && parsedH[nextIdx].mean === null) nextIdx++;

                if (prevIdx >= 0 && nextIdx < parsedH.length) {
                    const prevVal = parsedH[prevIdx].mean;
                    const nextVal = parsedH[nextIdx].mean;
                    const fraction = (i - prevIdx) / (nextIdx - prevIdx);
                    parsedH[i].mean = prevVal + (nextVal - prevVal) * fraction;
                    parsedH[i].min = parsedH[i].mean;
                    parsedH[i].max = parsedH[i].mean;
                } else if (prevIdx >= 0) {
                    parsedH[i].mean = parsedH[prevIdx].mean;
                    parsedH[i].min = parsedH[i].mean;
                    parsedH[i].max = parsedH[i].mean;
                } else if (nextIdx < parsedH.length) {
                    parsedH[i].mean = parsedH[nextIdx].mean;
                    parsedH[i].min = parsedH[i].mean;
                    parsedH[i].max = parsedH[i].mean;
                } else {
                    parsedH[i].mean = 0; parsedH[i].min = 0; parsedH[i].max = 0;
                }
            }
        }
        finalHourly = parsedH.filter(d => new Date(d.start).getTime() >= twentyFourHoursAgo)
                             .map(d => ({ 
                                 start: d.start, 
                                 mean: parseFloat(d.mean.toFixed(1)), 
                                 min: d.min !== null ? parseFloat(d.min.toFixed(1)) : null, 
                                 max: d.max !== null ? parseFloat(d.max.toFixed(1)) : null 
                             }));
    }

    return new Response(JSON.stringify({ entity: entityId, daily, monthly, hourly: finalHourly }), 
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_CRASH", message: error.message }), { status: 200 });
  }
};