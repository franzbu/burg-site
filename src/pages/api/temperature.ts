import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { HA_TOKEN } = env;
    if (!HA_TOKEN) return new Response(JSON.stringify({ error: "MISSING_SECRETS" }), { status: 200 });

    const url = new URL(request.url);
    const entityId = url.searchParams.get('entity_id');
    if (!entityId) return new Response(JSON.stringify({ error: "Missing entity_id" }), { status: 400 });

    const isCumulative = entityId.includes('sunshine') || entityId.includes('energy');
    
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

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const d = new Date();

    let dayStart, monthStart, mtdStart;
    const hourStart = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

    if (isCumulative) {
        dayStart = new Date(nowMs - 16 * 24 * 60 * 60 * 1000).toISOString();
        monthStart = new Date("2023-12-01T00:00:00Z").toISOString();
        mtdStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString();
    } else {
        dayStart = new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString();
        monthStart = new Date("2024-01-01T00:00:00Z").toISOString(); 
        mtdStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    }

    // NATIVE CLOUDFLARE WEBSOCKET IMPLEMENTATION
    const fetchLTSViaWebSocket = (): Promise<any> => {
        return new Promise(async (resolve, reject) => {
            try {
                const wsResponse = await fetch("https://ha.gitor.uk/api/websocket", {
                    headers: { "Upgrade": "websocket", "Connection": "Upgrade" }
                });
                
                const ws = wsResponse.webSocket;
                if (!ws) { reject(new Error("No websocket")); return; }
                
                ws.accept();

                let dailyData: any = null, monthlyData: any = null, mtdData: any = null, hourlyData: any = null;
                const timeout = setTimeout(() => { ws.close(); reject(new Error("WebSocket timeout")); }, 8000);

                const checkDone = () => {
                    if (dailyData !== null && monthlyData !== null && mtdData !== null && hourlyData !== null) {
                        clearTimeout(timeout); ws.close();
                        resolve({ dailyData, monthlyData, mtdData, hourlyData });
                    }
                };

                ws.addEventListener("message", (event) => {
                    const msg = JSON.parse(event.data as string);
                    if (msg.type === "auth_required") {
                        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN.trim() }));
                    } else if (msg.type === "auth_ok") {
                        ws.send(JSON.stringify({ id: 1, type: "recorder/statistics_during_period", start_time: dayStart, end_time: now, statistic_ids: queryIds, period: "day", types: statTypes }));
                        ws.send(JSON.stringify({ id: 2, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: queryIds, period: "month", types: statTypes }));
                        ws.send(JSON.stringify({ id: 3, type: "recorder/statistics_during_period", start_time: mtdStart, end_time: now, statistic_ids: queryIds, period: "day", types: statTypes }));
                        ws.send(JSON.stringify({ id: 4, type: "recorder/statistics_during_period", start_time: hourStart, end_time: now, statistic_ids: queryIds, period: "5minute", types: statTypes }));
                    } else if (msg.type === "result") {
                        if (msg.id === 1) dailyData = msg.result || {};
                        if (msg.id === 2) monthlyData = msg.result || {};
                        if (msg.id === 3) mtdData = msg.result || {};
                        if (msg.id === 4) hourlyData = msg.result || {};
                        checkDone();
                    }
                });
                ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS error")); });
            } catch (e) {
                reject(e);
            }
        });
    };

    const { dailyData, monthlyData, mtdData, hourlyData } = await fetchLTSViaWebSocket();
    const OFFSET_MS = 2 * 60 * 60 * 1000; 

    const extractData = (dataBlock: any, isCumulativeMode: boolean, expectedIntervalMs: number = 0) => {
        let combinedStats: any[] = [];
        for (const id of queryIds) {
            if (dataBlock[id]) combinedStats = combinedStats.concat(dataBlock[id]);
        }
        const uniqueMap = new Map();
        for (const s of combinedStats) uniqueMap.set(s.start, s);
        const stats = Array.from(uniqueMap.values()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

        if (!isCumulativeMode) {
            let parsed = stats.map((s: any) => {
                let val = s.mean !== undefined && s.mean !== null ? s.mean : null;
                let min = s.min !== undefined && s.min !== null ? s.min : val;
                let max = s.max !== undefined && s.max !== null ? s.max : val;
                const localDate = new Date(new Date(s.start).getTime() + OFFSET_MS);
                return { 
                    start: localDate.toISOString(), 
                    val: val !== null ? parseFloat(Number(val).toFixed(1)) : null,
                    min: min !== null ? parseFloat(Number(min).toFixed(1)) : null,
                    max: max !== null ? parseFloat(Number(max).toFixed(1)) : null
                };
            });

            if (expectedIntervalMs > 0 && parsed.length > 0) {
                const filled = [parsed[0]];
                for (let i = 1; i < parsed.length; i++) {
                    let prevTime = new Date(filled[filled.length - 1].start).getTime();
                    let currTime = new Date(parsed[i].start).getTime();
                    while (currTime - prevTime > expectedIntervalMs * 1.5) {
                        prevTime += expectedIntervalMs;
                        filled.push({ start: new Date(prevTime).toISOString(), val: null, min: null, max: null });
                    }
                    filled.push(parsed[i]);
                }
                const nowLocal = Date.now() + OFFSET_MS;
                let lastTime = new Date(filled[filled.length - 1].start).getTime();
                while (nowLocal - lastTime > expectedIntervalMs * 1.5) {
                    lastTime += expectedIntervalMs;
                    filled.push({ start: new Date(lastTime).toISOString(), val: null, min: null, max: null });
                }
                parsed = filled;
            }

            for (let i = 0; i < parsed.length; i++) {
                if (parsed[i].val === null) {
                    let prevIdx = i - 1;
                    while (prevIdx >= 0 && parsed[prevIdx].val === null) prevIdx--;
                    let nextIdx = i + 1;
                    while (nextIdx < parsed.length && parsed[nextIdx].val === null) nextIdx++;

                    if (prevIdx >= 0 && nextIdx < parsed.length) {
                        const prevVal = parsed[prevIdx].val;
                        const nextVal = parsed[nextIdx].val;
                        const fraction = (i - prevIdx) / (nextIdx - prevIdx);
                        parsed[i].val = parseFloat((prevVal + (nextVal - prevVal) * fraction).toFixed(1));
                        parsed[i].min = parsed[i].val;
                        parsed[i].max = parsed[i].val;
                    } else if (prevIdx >= 0) {
                        parsed[i].val = parsed[prevIdx].val;
                        parsed[i].min = parsed[i].val;
                        parsed[i].max = parsed[i].val;
                    } else if (nextIdx < parsed.length) {
                        parsed[i].val = parsed[nextIdx].val;
                        parsed[i].min = parsed[i].val;
                        parsed[i].max = parsed[i].val;
                    } else {
                        parsed[i].val = 0; parsed[i].min = 0; parsed[i].max = 0;
                    }
                }
            }
            return parsed;
        } else {
            const result = [];
            for (let i = 1; i < stats.length; i++) {
                const prev = stats[i - 1][statType] !== undefined && stats[i - 1][statType] !== null ? stats[i - 1][statType] : 0;
                const curr = stats[i][statType] !== undefined && stats[i][statType] !== null ? stats[i][statType] : 0;
                const diff = Math.max(0, curr - prev);
                const localDate = new Date(new Date(stats[i].start).getTime() + OFFSET_MS);
                result.push({ start: localDate.toISOString(), val: parseFloat(diff.toFixed(1)) });
            }
            return result;
        }
    };

    let dailyExtracted = extractData(dailyData, isCumulative, 24 * 60 * 60 * 1000);
    if (isCumulative) dailyExtracted = dailyExtracted.slice(-15);
    const daily = dailyExtracted.slice(-15).map((d: any) => ({ start: d.start, mean: d.val, min: d.min, max: d.max }));
    
    let hourlyExtracted = extractData(hourlyData, isCumulative, 5 * 60 * 1000);
    const twentyFourHoursAgoShifted = nowMs - (24 * 60 * 60 * 1000) + OFFSET_MS;
    const hourly = hourlyExtracted
        .filter((d: any) => new Date(d.start).getTime() >= twentyFourHoursAgoShifted)
        .map((d: any) => ({ start: d.start, mean: d.val, min: d.min, max: d.max }));

    let monthly = extractData(monthlyData, isCumulative, 0).map((m: any) => {
        const date = new Date(m.start);
        date.setUTCDate(1); 
        return { start: date.toISOString(), mean: m.val, min: m.min, max: m.max };
    });
    
    const currentMonthDays = extractData(mtdData, isCumulative, 0);
    if (currentMonthDays.length > 0) {
        let mtdVal = 0;
        let mtdMin = null;
        let mtdMax = null;

        if (isCumulative) {
            mtdVal = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0);
        } else {
            mtdVal = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0) / currentMonthDays.length;
            const validMins = currentMonthDays.map((d: any) => d.min).filter((v: any) => v !== null);
            const validMaxs = currentMonthDays.map((d: any) => d.max).filter((v: any) => v !== null);
            if (validMins.length > 0) mtdMin = Math.min(...validMins);
            if (validMaxs.length > 0) mtdMax = Math.max(...validMaxs);
        }
        
        const currentMonthStartISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
        const currentMonthPrefix = currentMonthStartISO.substring(0, 7); 
        const existingIndex = monthly.findIndex((m: any) => m.start.startsWith(currentMonthPrefix));
        if (existingIndex !== -1) {
            monthly[existingIndex].mean = parseFloat(mtdVal.toFixed(1)); 
            if (mtdMin !== null) monthly[existingIndex].min = parseFloat(mtdMin.toFixed(1));
            if (mtdMax !== null) monthly[existingIndex].max = parseFloat(mtdMax.toFixed(1));
        } else {
            monthly.push({ 
                start: currentMonthStartISO, 
                mean: parseFloat(mtdVal.toFixed(1)),
                min: mtdMin !== null ? parseFloat(mtdMin.toFixed(1)) : null,
                max: mtdMax !== null ? parseFloat(mtdMax.toFixed(1)) : null
            }); 
        }
    }

    return new Response(JSON.stringify({ entity: entityId, daily, monthly, hourly }), 
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_CRASH", message: error.message }), { status: 200 });
  }
};