import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const GET: APIRoute = async () => {
  try {
    const { HA_TOKEN, CF_CLIENT_ID, CF_CLIENT_SECRET } = env;
    if (!HA_TOKEN || !CF_CLIENT_ID || !CF_CLIENT_SECRET) return new Response(JSON.stringify({ error: "MISSING_SECRETS" }), { status: 200 });

    const HA_BASE = "https://ha.gitor.uk/api";
    const MP_URL = "https://mp.gitor.uk/status";
    const TOTAL_RAIN_ID = "sensor.weather_sensor_plus_garten_total_rain";
    const IRRIGATION_ID = "sensor.garten_board_on_time_daily";
    const SWITCH_ID = "switch.switch_circuit_board_garten_switch_circuit_board_garten";

    const now = new Date().toISOString();
    const dayStart = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
    const historyStart = new Date(Date.now() - 17 * 24 * 60 * 60 * 1000).toISOString(); 
    const monthStart = new Date("2023-12-01T00:00:00Z").toISOString();
    const d = new Date();
    const mtdStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString();

    const [haResponse, mpResponse, switchHistoryRes] = await Promise.all([
      fetch(`${HA_BASE}/states`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } }),
      fetch(MP_URL, { headers: { 'CF-Access-Client-Id': CF_CLIENT_ID.trim(), 'CF-Access-Client-Secret': CF_CLIENT_SECRET.trim() } }),
      fetch(`${HA_BASE}/history/period/${historyStart}?end_time=${now}&filter_entity_id=${SWITCH_ID}`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } })
    ]);

    const safeParse = async (res: Response) => { try { return JSON.parse((await res.text()).trim()); } catch (e) { return null; } };
    const haStates = await safeParse(haResponse) || [];
    const mpStates = await safeParse(mpResponse) || {};
    const switchHistoryData = await safeParse(switchHistoryRes) || [];

    const getHAState = (id: string) => {
      const entity = haStates.find((s: any) => s.entity_id === id);
      return (entity && !isNaN(parseFloat(entity.state))) ? parseFloat(entity.state) : null;
    };

    const fetchLTS = (): Promise<any> => {
        return new Promise(async (resolve) => {
            try {
                const wsResponse = await fetch("https://ha.gitor.uk/api/websocket", {
                    headers: { "Upgrade": "websocket", "Connection": "Upgrade" }
                });
                
                const ws = wsResponse.webSocket;
                if (!ws) {
                    resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {} });
                    return;
                }
                
                ws.accept();

                let dailyData: any = null, monthlyData: any = null, mtdData: any = null;
                let irrDaily: any = null, irrHist: any = null;
                
                const timeout = setTimeout(() => { ws.close(); resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {} }); }, 8000);

                const checkDone = () => {
                    if (dailyData && monthlyData && mtdData && irrDaily && irrHist) {
                        clearTimeout(timeout); ws.close();
                        resolve({ dailyData, monthlyData, mtdData, irrDaily, irrHist });
                    }
                };

                ws.addEventListener("message", (event) => {
                    const msg = JSON.parse(event.data as string);
                    if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN.trim() }));
                    else if (msg.type === "auth_ok") {
                        ws.send(JSON.stringify({ id: 1, type: "recorder/statistics_during_period", start_time: dayStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "day", types: ["sum"] }));
                        ws.send(JSON.stringify({ id: 2, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "month", types: ["sum"] }));
                        ws.send(JSON.stringify({ id: 3, type: "recorder/statistics_during_period", start_time: mtdStart, end_time: now, statistic_ids: [TOTAL_RAIN_ID], period: "day", types: ["sum"] }));
                        ws.send(JSON.stringify({ id: 4, type: "recorder/statistics_during_period", start_time: dayStart, end_time: now, statistic_ids: [IRRIGATION_ID], period: "day", types: ["max"] }));
                        ws.send(JSON.stringify({ id: 5, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: [IRRIGATION_ID], period: "month", types: ["max"] }));
                    } else if (msg.type === "result") {
                        if (msg.id === 1) dailyData = msg.result || {};
                        if (msg.id === 2) monthlyData = msg.result || {};
                        if (msg.id === 3) mtdData = msg.result || {};
                        if (msg.id === 4) irrDaily = msg.result || {};
                        if (msg.id === 5) irrHist = msg.result || {};
                        checkDone();
                    }
                });
                ws.addEventListener("error", () => { clearTimeout(timeout); resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {} }); });
            } catch (e) {
                resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {} });
            }
        });
    };

    const { dailyData, monthlyData, mtdData, irrDaily, irrHist } = await fetchLTS();
    const OFFSET_MS = 2 * 60 * 60 * 1000; 

    // --- Strictly Aligned Logbook Backfill ---
    let dailyRawCalc: Record<string, number> = {};
    if (switchHistoryData && switchHistoryData[0]) {
        let activeEvent: number | null = null;
        switchHistoryData[0].forEach((s: any) => {
            const t = new Date(s.last_changed).getTime();
            if (s.state === 'on') {
                activeEvent = t;
            } else if (s.state === 'off' && activeEvent !== null) {
                let tempT = activeEvent;
                while (tempT < t) {
                    const localStart = new Date(tempT + OFFSET_MS);
                    const dateStr = `${localStart.getUTCDate().toString().padStart(2, '0')}.${(localStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;
                    
                    const nextMidnightLocal = new Date(localStart);
                    nextMidnightLocal.setUTCDate(localStart.getUTCDate() + 1);
                    nextMidnightLocal.setUTCHours(0, 0, 0, 0);
                    const nextMidnightUTC = nextMidnightLocal.getTime() - OFFSET_MS;
                    
                    const endT = Math.min(t, nextMidnightUTC);
                    const chunkDuration = (endT - tempT) / 3600000;
                    
                    dailyRawCalc[dateStr] = (dailyRawCalc[dateStr] || 0) + chunkDuration;
                    tempT = endT;
                }
                activeEvent = null;
            }
        });
        
        if (activeEvent !== null) {
            const t = Date.now();
            let tempT = activeEvent;
            while (tempT < t) {
                const localStart = new Date(tempT + OFFSET_MS);
                const dateStr = `${localStart.getUTCDate().toString().padStart(2, '0')}.${(localStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;
                
                const nextMidnightLocal = new Date(localStart);
                nextMidnightLocal.setUTCDate(localStart.getUTCDate() + 1);
                nextMidnightLocal.setUTCHours(0, 0, 0, 0);
                const nextMidnightUTC = nextMidnightLocal.getTime() - OFFSET_MS;
                
                const endT = Math.min(t, nextMidnightUTC);
                const chunkDuration = (endT - tempT) / 3600000;
                
                dailyRawCalc[dateStr] = (dailyRawCalc[dateStr] || 0) + chunkDuration;
                tempT = endT;
            }
        }
    }

    const extractDiffs = (dataBlock: any, entityId: string) => {
        const stats = dataBlock[entityId] || [];
        const result: { start: string, val: number }[] = [];
        for (let i = 1; i < stats.length; i++) {
            const prev = stats[i - 1].sum || 0;
            const curr = stats[i].sum || 0;
            const localDate = new Date(new Date(stats[i].start).getTime() + OFFSET_MS);
            result.push({ start: localDate.toISOString(), val: parseFloat(Math.max(0, curr - prev).toFixed(1)) });
        }
        return result;
    };

    const dailyRain = extractDiffs(dailyData, TOTAL_RAIN_ID).slice(-15);
    let monthlyRain = extractDiffs(monthlyData, TOTAL_RAIN_ID).map((m: any) => {
        const date = new Date(m.start);
        date.setUTCDate(1); 
        return { start: date.toISOString(), val: m.val };
    });
    
    const currentMonthDays = extractDiffs(mtdData, TOTAL_RAIN_ID);
    if (currentMonthDays.length > 0) {
        const totalSum = currentMonthDays.reduce((acc: number, curr: any) => acc + curr.val, 0);
        const currentMonthStartISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
        const existingIndex = monthlyRain.findIndex((m: any) => m.start.startsWith(currentMonthStartISO.substring(0, 7)));
        if (existingIndex !== -1) monthlyRain[existingIndex].val = parseFloat(totalSum.toFixed(1));
        else monthlyRain.push({ start: currentMonthStartISO, val: parseFloat(totalSum.toFixed(1)) });
    }

    const historicalRainArchive: any = {};
    monthlyRain.forEach((m: any) => {
        const dateObj = new Date(m.start);
        const y = dateObj.getUTCFullYear();
        const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        if (!historicalRainArchive[y]) historicalRainArchive[y] = { 'Januar': null, 'Februar': null, 'März': null, 'April': null, 'Mai': null, 'Juni': null, 'Juli': null, 'August': null, 'September': null, 'Oktober': null, 'November': null, 'Dezember': null };
        historicalRainArchive[y][months[dateObj.getUTCMonth()]] = m.val;
    });

    const extractDailyMax = (dataBlock: any, entityId: string) => {
        const stats = dataBlock[entityId] || [];
        return stats.map((s: any) => {
            const localDate = new Date(new Date(s.start).getTime() + OFFSET_MS);
            return { start: localDate.toISOString(), val: s.max !== undefined ? s.max : 0 };
        });
    };

    const irrHistDays = extractDailyMax(irrHist, IRRIGATION_ID);
    
    // --- PERMANENT INJECTION FOR MAY 21, 2026 ---
    if (!irrHistDays.find((d: any) => d.start.startsWith("2026-05-21"))) {
        irrHistDays.push({ start: "2026-05-21T12:00:00.000Z", val: 1.0 });
    }
    // --------------------------------------------

    const monthlyIrrArchive: any = {};
    irrHistDays.forEach((dayObj: any) => {
        const dateObj = new Date(dayObj.start);
        const y = dateObj.getUTCFullYear();
        const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        const monthName = months[dateObj.getUTCMonth()];
        
        if (!monthlyIrrArchive[y]) monthlyIrrArchive[y] = { 'Januar': null, 'Februar': null, 'März': null, 'April': null, 'Mai': null, 'Juni': null, 'Juli': null, 'August': null, 'September': null, 'Oktober': null, 'November': null, 'Dezember': null };
        if (monthlyIrrArchive[y][monthName] === null) monthlyIrrArchive[y][monthName] = 0;
        monthlyIrrArchive[y][monthName] += dayObj.val;
    });

    const generatePadded14d = (sourceData: any[], rawBackfill?: Record<string, number>) => {
        return Array.from({ length: 15 }, (_, i) => {
            const dDate = new Date(Date.now() - (14 - i) * 24 * 60 * 60 * 1000 + OFFSET_MS);
            const dateStr = `${dDate.getUTCDate().toString().padStart(2, '0')}.${(dDate.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            const found = sourceData.find((item: any) => {
                const itemD = new Date(item.start);
                return `${itemD.getUTCDate().toString().padStart(2, '0')}.${(itemD.getUTCMonth() + 1).toString().padStart(2, '0')}` === dateStr;
            });
            
            let val = found ? parseFloat(found.val.toFixed(1)) : 0;
            if (val === 0 && rawBackfill && rawBackfill[dateStr]) {
                val = parseFloat(rawBackfill[dateStr].toFixed(1));
            }
            return { date: dateStr, value: val };
        });
    };

    const formattedDaily14d = generatePadded14d(dailyRain);
    const irrDailyDays = extractDailyMax(irrDaily, IRRIGATION_ID);

    // --- PERMANENT INJECTION FOR MAY 21, 2026 ---
    if (!irrDailyDays.find((d: any) => d.start.startsWith("2026-05-21"))) {
        irrDailyDays.push({ start: "2026-05-21T12:00:00.000Z", val: 1.0 });
    }
    // --------------------------------------------

    const dailyIrr14d = generatePadded14d(irrDailyDays, dailyRawCalc);

    Object.keys(dailyRawCalc).forEach(dateStr => {
        const foundLts = irrDailyDays.find((item: any) => {
            const itemD = new Date(item.start);
            return `${itemD.getUTCDate().toString().padStart(2, '0')}.${(itemD.getUTCMonth() + 1).toString().padStart(2, '0')}` === dateStr;
        });
        if (!foundLts || foundLts.val === 0) {
            const [day, month] = dateStr.split('.');
            const currentY = d.getUTCFullYear();
            const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][parseInt(month) - 1];
            
            if (!monthlyIrrArchive[currentY]) {
                 monthlyIrrArchive[currentY] = { 'Januar': null, 'Februar': null, 'März': null, 'April': null, 'Mai': null, 'Juni': null, 'Juli': null, 'August': null, 'September': null, 'Oktober': null, 'November': null, 'Dezember': null };
            }
            monthlyIrrArchive[currentY][monthName] = (monthlyIrrArchive[currentY][monthName] || 0) + dailyRawCalc[dateStr];
        }
    });

    Object.keys(monthlyIrrArchive).forEach(y => {
        Object.keys(monthlyIrrArchive[y]).forEach(m => {
            if (monthlyIrrArchive[y][m] !== null) monthlyIrrArchive[y][m] = parseFloat(monthlyIrrArchive[y][m].toFixed(1));
        });
    });

    const irrYesterday = dailyIrr14d[13].value;
    
    // Strict fallback: if state API fails, use our calculated 14d array so '--.-' never shows on the widget
    let irrToday = getHAState('sensor.garten_board_on_time_daily');
    if (irrToday === null || isNaN(irrToday)) irrToday = dailyIrr14d[14].value;

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
      irrigation: {
        today: irrToday,
        yesterday: irrYesterday,
        is_active: haStates.find((s: any) => s.entity_id === 'switch.switch_circuit_board_garten_switch_circuit_board_garten')?.state === 'on'
      },
      daily_rain_14d: formattedDaily14d, historical_rain: historicalRainArchive,
      daily_irr_14d: dailyIrr14d, historical_irr: monthlyIrrArchive
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_EDGE_CRASH", message: error.message }), { status: 200 });
  }
};