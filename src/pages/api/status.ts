import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const HA_TOKEN = process.env.HA_TOKEN || import.meta.env.HA_TOKEN;
  const HA_URL = "https://ha.gitor.uk/api/states";

  if (!HA_TOKEN) {
    return new Response(JSON.stringify({ error: "Missing HA_TOKEN environment variable" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Fetch state vectors directly from your public Home Assistant Tunnel
    const response = await fetch(HA_URL, {
      headers: {
        'Authorization': `Bearer ${HA_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error(`Home Assistant API returned status ${response.status}`);
    const states = await response.json();

    // Helper function to pull state values safely out of the array buffer
    const getEntityState = (entityId: string) => {
      const entity = states.find((s: any) => s.entity_id === entityId);
      return entity ? parseFloat(entity.state) : null;
    };

    const getEntityAttribute = (entityId: string, attr: string) => {
      const entity = states.find((s: any) => s.entity_id === entityId);
      return entity && entity.attributes ? entity.attributes[attr] : null;
    };

    // --- ENTITY ID MAPPINGS ---
    // Change these strings to match the exact entity names inside your Home Assistant instance
    const weatherStationData = {
      temp: getEntityState('sensor.hmip_swo_pl_temperature'),
      hum: getEntityState('sensor.hmip_swo_pl_humidity'),
      wind: getEntityState('sensor.hmip_swo_pl_wind_speed'),
      lux: getEntityState('sensor.hmip_swo_pl_illumination'),
      rain_today: getEntityState('sensor.hmip_swo_pl_rain_today'),
      rain_yesterday: getEntityState('sensor.hmip_swo_pl_rain_yesterday'),
      wind_direction: getEntityAttribute('sensor.hmip_swo_pl_wind_direction', 'direction') || 'Nord-Ost (45°)',
      sunshine_duration: getEntityState('sensor.hmip_swo_pl_sunshine_duration_today'), // in minutes
      is_raining: states.find((s: any) => s.entity_id === 'binary_sensor.hmip_swo_pl_raining')?.state === 'on',
      is_stormy: states.find((s: any) => s.entity_id === 'binary_sensor.hmip_swo_pl_storm')?.state === 'on'
    };

    // Assemble the complete live payload layout matched to your client-side targets
    const payload = {
      uptime: Math.floor(process.uptime()), 
      weather_station: weatherStationData,
      house_north: { temp: getEntityState('sensor.fassade_nord_temperature') },
      house_south: { temp: getEntityState('sensor.fassade_sud_temperature') },
      house_east: { temp: getEntityState('sensor.fassade_ost_temperature') },
      house_west: { temp: getEntityState('sensor.fassade_west_temperature') },
      greenhouse: { temp: getEntityState('sensor.gewachshaus_temperature') },
      historical_rain: {
        'Januar': 64.2, 'Februar': 48.1, 'März': 72.5, 'April': 38.0, 'Mai': weatherStationData.rain_today || 14.2,
        'Juni': 0.0, 'Juli': 0.0, 'August': 0.0, 'September': 0.0, 'Oktober': 0.0, 'November': 0.0, 'Dezember': 0.0
      }
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30' // Cache at edge for 30s to preserve HA bandwidth
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};