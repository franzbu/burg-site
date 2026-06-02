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
    const OUTDOOR_TEMP_ID = "sensor.weather_sensor_plus_garten_temperature";
    const GREENHOUSE_TEMP_ID = "sensor.temperature_and_humidity_sensor_outdoor_garten_temperature";
    const ACUTE_RAIN_ID = "binary_sensor.weather_sensor_plus_garten_raining,sensor.weather_sensor_plus_garten_raining";

    const OFFSET_MS = 2 * 60 * 60 * 1000; // Italy CEST offset
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const d = new Date(nowMs);
    
    // Accurately lock midnight to local Italian time, not UTC
    const localTime = new Date(nowMs + OFFSET_MS);
    localTime.setUTCHours(0, 0, 0, 0);
    const todayMidnightISO = new Date(localTime.getTime() - OFFSET_MS).toISOString();

    const dayStart = new Date(nowMs - 16 * 24 * 60 * 60 * 1000).toISOString();
    const historyStart = new Date(nowMs - 17 * 24 * 60 * 60 * 1000).toISOString(); 
    const monthStart = new Date("2023-12-01T00:00:00Z").toISOString();
    const mtdStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString();

    const [haResponse, mpResponse, switchHistoryRes, acuteRainHistoryRes] = await Promise.all([
      fetch(`${HA_BASE}/states`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } }),
      fetch(MP_URL, { headers: { 'CF-Access-Client-Id': CF_CLIENT_ID.trim(), 'CF-Access-Client-Secret': CF_CLIENT_SECRET.trim() } }),
      fetch(`${HA_BASE}/history/period/${historyStart}?end_time=${now}&filter_entity_id=${SWITCH_ID}`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } }),
      fetch(`${HA_BASE}/history/period/${monthStart}?end_time=${now}&filter_entity_id=${ACUTE_RAIN_ID}`, { headers: { 'Authorization': `Bearer ${HA_TOKEN.trim()}` } })
    ]);

    const safeParse = async (res: Response) => { try { return JSON.parse((await res.text()).trim()); } catch (e) { return null; } };
    const haStates = await safeParse(haResponse) || [];
    const mpStates = await safeParse(mpResponse) || {};
    const switchHistoryData = await safeParse(switchHistoryRes) || [];
    const acuteRainHistoryData = await safeParse(acuteRainHistoryRes) || [];

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
                    resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {}, extremes: {} });
                    return;
                }
                
                ws.accept();

                let dailyData: any = null, monthlyData: any = null, mtdData: any = null;
                let irrDaily: any = null, irrHist: any = null, extremes: any = null;
                
                const timeout = setTimeout(() => { ws.close(); resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {}, extremes: {} }); }, 8000);

                const checkDone = () => {
                    if (dailyData && monthlyData && mtdData && irrDaily && irrHist && extremes) {
                        clearTimeout(timeout); ws.close();
                        resolve({ dailyData, monthlyData, mtdData, irrDaily, irrHist, extremes });
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
                        ws.send(JSON.stringify({ id: 5, type: "recorder/statistics_during_period", start_time: monthStart, end_time: now, statistic_ids: [IRRIGATION_ID], period: "day", types: ["max"] }));
                        ws.send(JSON.stringify({ id: 6, type: "recorder/statistics_during_period", start_time: todayMidnightISO, end_time: now, statistic_ids: [OUTDOOR_TEMP_ID, GREENHOUSE_TEMP_ID], period: "5minute", types: ["min", "max"] }));
                    } else if (msg.type === "result") {
                        if (msg.id === 1) dailyData = msg.result || {};
                        if (msg.id === 2) monthlyData = msg.result || {};
                        if (msg.id === 3) mtdData = msg.result || {};
                        if (msg.id === 4) irrDaily = msg.result || {};
                        if (msg.id === 5) irrHist = msg.result || {};
                        if (msg.id === 6) extremes = msg.result || {};
                        checkDone();
                    }
                });
                ws.addEventListener("error", () => { clearTimeout(timeout); resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {}, extremes: {} }); });
            } catch (e) {
                resolve({ dailyData: {}, monthlyData: {}, mtdData: {}, irrDaily: {}, irrHist: {}, extremes: {} });
            }
        });
    };

    const lts = await fetchLTS();

    const getExtremes = (dataBlock: any, entityId: string) => {
        const stats = dataBlock[entityId] || [];
        let min = null;
        let max = null;
        stats.forEach((s: any) => {
            if (s.min !== undefined && s.min !== null) min = min === null ? s.min : Math.min(min, s.min);
            if (s.max !== undefined && s.max !== null) max = max === null ? s.max : Math.max(max, s.max);
        });
        return { min, max };
    };
    const outdoorExtremes = getExtremes(lts.extremes, OUTDOOR_TEMP_ID);
    const greenhouseExtremes = getExtremes(lts.extremes, GREENHOUSE_TEMP_ID);

    // --- Strictly Aligned Logbook Backfill (Irrigation) ---
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

    // --- Raw History Parser for Acute Rain ---
    let acuteDailyRaw: Record<string, number> = {};
    let acuteMonthlyRaw: Record<string, number> = {};
    let combinedRainHistory: any[] = [];
    
    acuteRainHistoryData.forEach((entityHistory: any[]) => {
        combinedRainHistory = combinedRainHistory.concat(entityHistory);
    });
    combinedRainHistory.sort((a, b) => new Date(a.last_changed || a.last_updated).getTime() - new Date(b.last_changed || b.last_updated).getTime());

    let sensorCreationTime = nowMs;
    if (combinedRainHistory.length > 0) {
        sensorCreationTime = new Date(combinedRainHistory[0].last_changed || combinedRainHistory[0].last_updated).getTime();
    }

    let rainActiveEvent: number | null = null;
    combinedRainHistory.forEach((s: any) => {
        const t = new Date(s.last_changed || s.last_updated).getTime();
        const stateStr = String(s.state).toLowerCase();
        const isRaining = stateStr === 'on' || stateStr === 'true' || stateStr === '1' || stateStr.includes('rain') || stateStr.includes('wet') || stateStr.includes('regen') || stateStr.includes('feucht');
        
        if (isRaining && rainActiveEvent === null) {
            rainActiveEvent = t;
        } else if (!isRaining && rainActiveEvent !== null) {
            let tempT = rainActiveEvent;
            while (tempT < t) {
                const localStart = new Date(tempT + OFFSET_MS);
                const dateStr = `${localStart.getUTCDate().toString().padStart(2, '0')}.${(localStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;
                const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][localStart.getUTCMonth()];
                const year = localStart.getUTCFullYear();
                
                const nextMidnightLocal = new Date(localStart);
                nextMidnightLocal.setUTCDate(localStart.getUTCDate() + 1);
                nextMidnightLocal.setUTCHours(0, 0, 0, 0);
                const nextMidnightUTC = nextMidnightLocal.getTime() - OFFSET_MS;
                
                const endT = Math.min(t, nextMidnightUTC);
                const chunkSecs = (endT - tempT) / 1000;
                
                acuteDailyRaw[dateStr] = (acuteDailyRaw[dateStr] || 0) + chunkSecs;
                const ymStr = `${year}-${monthName}`;
                acuteMonthlyRaw[ymStr] = (acuteMonthlyRaw[ymStr] || 0) + chunkSecs;
                
                tempT = endT;
            }
            rainActiveEvent = null;
        }
    });

    if (rainActiveEvent !== null) {
        const t = Date.now();
        let tempT = rainActiveEvent;
        while (tempT < t) {
            const localStart = new Date(tempT + OFFSET_MS);
            const dateStr = `${localStart.getUTCDate().toString().padStart(2, '0')}.${(localStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][localStart.getUTCMonth()];
            const year = localStart.getUTCFullYear();
            
            const nextMidnightLocal = new Date(localStart);
            nextMidnightLocal.setUTCDate(localStart.getUTCDate() + 1);
            nextMidnightLocal.setUTCHours(0, 0, 0, 0);
            const nextMidnightUTC = nextMidnightLocal.getTime() - OFFSET_MS;
            
            const endT = Math.min(t, nextMidnightUTC);
            const chunkSecs = (endT - tempT) / 1000;
            
            acuteDailyRaw[dateStr] = (acuteDailyRaw[dateStr] || 0) + chunkSecs;
            const ymStr = `${year}-${monthName}`;
            acuteMonthlyRaw[ymStr] = (acuteMonthlyRaw[ymStr] || 0) + chunkSecs;
            
            tempT = endT;
        }
    }

    const dailyAcuteRain15d = Array.from({ length: 15 }, (_, i) => {
        const dDate = new Date(Date.now() - (14 - i) * 24 * 60 * 60 * 1000 + OFFSET_MS);
        const dateStr = `${dDate.getUTCDate().toString().padStart(2, '0')}.${(dDate.getUTCMonth() + 1).toString().padStart(2, '0')}`;
        const seconds = acuteDailyRaw[dateStr] || 0;
        const minutes = seconds / 60;
        const percentage = Math.min(100, (seconds / 86400) * 100);
        return { date: dateStr, minutes: parseFloat(minutes.toFixed(1)), percentage: parseFloat(percentage.toFixed(1)) };
    });

    const historicalAcuteRain: any = {};
    const startD = new Date(sensorCreationTime);
    startD.setUTCDate(1);
    startD.setUTCHours(0, 0, 0, 0);

    const endD = new Date();
    
    while (startD <= endD) {
        const y = startD.getUTCFullYear();
        const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][startD.getUTCMonth()];
        
        if (!historicalAcuteRain[y]) {
            historicalAcuteRain[y] = { 'Januar': null, 'Februar': null, 'März': null, 'April': null, 'Mai': null, 'Juni': null, 'Juli': null, 'August': null, 'September': null, 'Oktober': null, 'November': null, 'Dezember': null };
        }
        
        const ymStr = `${y}-${monthName}`;
        const seconds = acuteMonthlyRaw[ymStr] || 0;
        
        const daysInMonth = new Date(y, startD.getUTCMonth() + 1, 0).getDate();
        const totalSecondsInMonth = daysInMonth * 86400;
        const minutes = seconds / 60;
        const percentage = Math.min(100, (seconds / totalSecondsInMonth) * 100);
        
        historicalAcuteRain[y][monthName] = { minutes: parseFloat(minutes.toFixed(1)), percentage: parseFloat(percentage.toFixed(1)) };
        
        startD.setUTCMonth(startD.getUTCMonth() + 1);
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

    const dailyRain = extractDiffs(lts.dailyData, TOTAL_RAIN_ID).slice(-15);
    
    let monthlyRain = extractDiffs(lts.monthlyData, TOTAL_RAIN_ID).map((m: any) => {
        const date = new Date(m.start);
        date.setUTCHours(date.getUTCHours() + 12);
        const cleanStart = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
        return { start: cleanStart, val: m.val };
    });
    
    const currentMonthDays = extractDiffs(lts.mtdData, TOTAL_RAIN_ID);
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

    const irrHistDays = extractDailyMax(lts.irrHist, IRRIGATION_ID);

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
    const irrDailyDays = extractDailyMax(lts.irrDaily, IRRIGATION_ID);

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
    let irrToday = getHAState('sensor.garten_board_on_time_daily');
    if (irrToday === null || isNaN(irrToday)) irrToday = dailyIrr14d[14].value;

    // --- Clean Backend Data Normalization (Fixes HA's UTC LTS bucket overlap) ---
    const ltsTodayVal = dailyIrr14d[14].value;
    if (irrToday !== null && ltsTodayVal !== irrToday) {
        const discrepancy = ltsTodayVal - irrToday;
        dailyIrr14d[14].value = irrToday;

        const currentY = d.getUTCFullYear();
        const monthName = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][d.getUTCMonth()];
        
        if (monthlyIrrArchive[currentY] && monthlyIrrArchive[currentY][monthName] != null) {
            monthlyIrrArchive[currentY][monthName] -= discrepancy;
            if (monthlyIrrArchive[currentY][monthName] < 0) monthlyIrrArchive[currentY][monthName] = 0;
            monthlyIrrArchive[currentY][monthName] = parseFloat(monthlyIrrArchive[currentY][monthName].toFixed(1));
        }
    }
    // -----------------------------------------------------------------------------

    return new Response(JSON.stringify({
      weather_station: {
        ...mpStates.weather_station,
        temp_min: outdoorExtremes.min !== null ? outdoorExtremes.min : mpStates.weather_station?.temp_min,
        temp_max: outdoorExtremes.max !== null ? outdoorExtremes.max : mpStates.weather_station?.temp_max,
        rain_yesterday: mpStates.weather_station?.rain_yesterday ?? getHAState('sensor.weather_sensor_plus_garten_yesterday_s_rain'),
        sunshine_duration: mpStates.weather_station?.sunshine_duration ?? getHAState('sensor.weather_sensor_plus_garten_today_s_sunshine_duration')
      },
      house_north: { temp: mpStates.house_north?.temp ?? null }, 
      house_south: { temp: mpStates.house_south?.temp ?? null }, 
      house_east: { temp: mpStates.house_east?.temp ?? null }, 
      house_west: { temp: mpStates.house_west?.temp ?? null }, 
      greenhouse: { 
        temp: mpStates.greenhouse?.temp ?? null,
        temp_min: greenhouseExtremes.min ?? null,
        temp_max: greenhouseExtremes.max ?? null,
        watchdog_active: mpStates.watchdog_active ?? true,
        heater_energy: getHAState('sensor.switching_and_measuring_cable_outdoor_energy_counter')
      },
      irrigation: {
        today: irrToday,
        yesterday: irrYesterday,
        is_active: haStates.find((s: any) => s.entity_id === 'switch.switch_circuit_board_garten_switch_circuit_board_garten')?.state === 'on'
      },
      daily_rain_14d: formattedDaily14d, historical_rain: historicalRainArchive,
      daily_irr_14d: dailyIrr14d, historical_irr: monthlyIrrArchive,
      daily_acute_rain_15d: dailyAcuteRain15d, historical_acute_rain: historicalAcuteRain
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "FATAL_EDGE_CRASH", message: error.message }), { status: 200 });
  }
};