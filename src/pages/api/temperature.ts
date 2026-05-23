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
    
    let statType = "mean";
    if (entityId.includes('energy')) statType = "state";
    else if (isCumulative) statType = "sum";

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const d = new Date();

    let dayStart, monthStart, mtdStart;

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

                let dailyData: any = null, monthlyData: any = null, mtdData: any = null;
                const timeout = setTimeout(() => { ws.close(); reject(new Error("WebSocket timeout")); }, 8000);

                const checkDone = () => {
                    if (dailyData !== null && monthlyData !== null && mtdData !== null) {
                        clearTimeout(timeout); ws.close();
                        resolve({ dailyData, monthlyData, mtdData });
                    }
                };

                ws.addEventListener("message", (event) => {
                    const msg = JSON.parse(event.data as string);
                    if (msg.type === "auth_required") {
                        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN.trim() }));
                    } else if (msg.type === "auth_ok") {
                        ws.send(JSON.stringify({ id: 1, type: "recorder/statistics_during_period", start_time: dayStart, end_time: now, statistic_ids: [entityId], period: "day", types: [statType] }));
                        ws.send(JSON.stringify({ id: 2, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: [entityId], period: "month", types: [statType] }));
                        ws.send(JSON.stringify({ id: 3, type: "recorder/statistics_during_period", start_time: mtdStart, end_time: now, statistic_ids: [entityId], period: "day", types: [statType] }));
                    } else if (msg.type === "result") {
                        if (msg.id === 1) dailyData = msg.result || {};
                        if (msg.id === 2) monthlyData = msg.result || {};
                        if (msg.id === 3) mtdData = msg.result || {};
                        checkDone();
                    }
                });
                ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WS error")); });
            } catch (e) {
                reject(e);
            }
        });
    };

    const { dailyData, monthlyData, mtdData } = await fetchLTSViaWebSocket();
    const OFFSET_MS = 2 * 60 * 60 * 1000; 

    const extractData = (dataBlock: any, isCumulativeMode: boolean) => {
        const stats = dataBlock[entityId] || [];
        if (!isCumulativeMode) {
            return stats.map((s: any) => {
                let val = s.mean !== undefined && s.mean !== null ? s.mean : null;
                const localDate = new Date(new Date(s.start).getTime() + OFFSET_MS);
                return { start: localDate.toISOString(), val: val !== null ? parseFloat(Number(val).toFixed(1)) : null };
            }).filter((s: any) => s.val !== null);
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

    let dailyExtracted = extractData(dailyData, isCumulative);
    if (isCumulative) dailyExtracted = dailyExtracted.slice(-15);
    const daily = dailyExtracted.map(d => ({ start: d.start, mean: d.val }));
    
    let monthly = extractData(monthlyData, isCumulative).map((m: any) => {
        const date = new Date(m.start);
        date.setUTCDate(1); 
        return { start: date.toISOString(), mean: m.val };
    });
    
    const currentMonthDays = extractData(mtdData, isCumulative);
    if (currentMonthDays.length > 0) {
        let mtdVal = 0;
        if (isCumulative) mtdVal = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0);
        else mtdVal = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0) / currentMonthDays.length;
        
        const currentMonthStartISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
        const currentMonthPrefix = currentMonthStartISO.substring(0, 7); 
        const existingIndex = monthly.findIndex((m: any) => m.start.startsWith(currentMonthPrefix));
        if (existingIndex !== -1) monthly[existingIndex].mean = parseFloat(mtdVal.toFixed(1)); 
        else monthly.push({ start: currentMonthStartISO, mean: parseFloat(mtdVal.toFixed(1)) }); 
    }

    return new Response(JSON.stringify({ entity: entityId, daily, monthly }), 
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_CRASH", message: error.message }), { status: 200 });
  }
};