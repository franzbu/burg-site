import type {
  BurgLanguage,
} from "./locale";

/**
 * Compatibility IDs still accepted by the public
 * history endpoint and existing URLs.
 *
 * These are NOT our canonical internal metric IDs.
 */
export const LEGACY_ENTITY = {
  outdoorTemperature:
    "sensor.weather_sensor_plus_garten_temperature",

  northTemperature:
    "sensor.temperature_and_humidity_sensor_outdoor_north_temperature",

  southTemperature:
    "sensor.temperature_and_humidity_sensor_outdoor_balkon_temperature",

  eastTemperature:
    "sensor.temperature_and_humidity_sensor_outdoor_house_east_temperature",

  westTemperature:
    "sensor.temperature_and_humidity_sensor_outdoor_west_temperature",

  westTemperatureCurrentAlias:
    "sensor.temperature_and_humidity_sensor_outdoor_house_west_temperature",

  greenhouseTemperature:
    "sensor.temperature_and_humidity_sensor_outdoor_garten_temperature",

  windSpeed:
    "sensor.weather_sensor_plus_garten_wind_speed",

  humidity:
    "sensor.weather_sensor_plus_garten_humidity",

  illumination:
    "sensor.weather_sensor_plus_garten_illumination",

  rainTotal:
    "sensor.weather_sensor_plus_garten_total_rain",

  sunshineTotal:
    "sensor.weather_sensor_plus_garten_total_sunshine_duration",

  greenhouseHeaterEnergy:
    "sensor.switching_and_measuring_cable_outdoor_energy_counter",
} as const;


export type LegacyEntityId =
  (typeof LEGACY_ENTITY)[
    keyof typeof LEGACY_ENTITY
  ];


export type MetricKind =
  | "gauge"
  | "counter";


export interface MetricDefinition {
  canonical: string;
  kind: MetricKind;
  unit: string;
  decimals: number;

  labels: Record<
    BurgLanguage,
    string
  >;

  aliases:
    readonly LegacyEntityId[];
}


/**
 * Canonical BURG metric registry.
 *
 * From now on, new UI code should think in these
 * canonical IDs rather than Home-Assistant-era
 * sensor names.
 */
export const METRICS = {
  outdoorTemperature: {
    canonical:
      "weather.outdoor.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "Außentemperatur",
      en: "Outdoor Temperature",
      it: "Temperatura Esterna",
    },

    aliases: [
      LEGACY_ENTITY.outdoorTemperature,
    ],
  },


  northTemperature: {
    canonical:
      "house.north.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "Nord-Fassade",
      en: "North Facade",
      it: "Facciata Nord",
    },

    aliases: [
      LEGACY_ENTITY.northTemperature,
    ],
  },


  southTemperature: {
    canonical:
      "house.south.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "Süd-Fassade",
      en: "South Facade",
      it: "Facciata Sud",
    },

    aliases: [
      LEGACY_ENTITY.southTemperature,
    ],
  },


  eastTemperature: {
    canonical:
      "house.east.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "Ost-Fassade",
      en: "East Facade",
      it: "Facciata Est",
    },

    aliases: [
      LEGACY_ENTITY.eastTemperature,
    ],
  },


  westTemperature: {
    canonical:
      "house.west.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "West-Fassade",
      en: "West Facade",
      it: "Facciata Ovest",
    },

    aliases: [
      LEGACY_ENTITY
        .westTemperatureCurrentAlias,

      LEGACY_ENTITY
        .westTemperature,
    ],
  },


  greenhouseTemperature: {
    canonical:
      "greenhouse.temperature",

    kind:
      "gauge",

    unit:
      "°",

    decimals:
      1,

    labels: {
      de: "Gewächshaus (Temperatur)",
      en: "Greenhouse (Temperature)",
      it: "Serra (Temperatura)",
    },

    aliases: [
      LEGACY_ENTITY
        .greenhouseTemperature,
    ],
  },


  windSpeed: {
    canonical:
      "weather.wind_speed",

    kind:
      "gauge",

    unit:
      " km/h",

    decimals:
      1,

    labels: {
      de: "Windgeschwindigkeit",
      en: "Wind Speed",
      it: "Velocità Vento",
    },

    aliases: [
      LEGACY_ENTITY.windSpeed,
    ],
  },


  humidity: {
    canonical:
      "weather.outdoor.humidity",

    kind:
      "gauge",

    unit:
      "%",

    decimals:
      0,

    labels: {
      de: "Luftfeuchtigkeit",
      en: "Humidity",
      it: "Umidità",
    },

    aliases: [
      LEGACY_ENTITY.humidity,
    ],
  },


  illumination: {
    canonical:
      "weather.illumination",

    kind:
      "gauge",

    unit:
      " lx",

    decimals:
      0,

    labels: {
      de: "Helligkeit",
      en: "Brightness",
      it: "Luminosità",
    },

    aliases: [
      LEGACY_ENTITY.illumination,
    ],
  },


  rainTotal: {
    canonical:
      "weather.rain_total",

    kind:
      "counter",

    unit:
      " mm",

    decimals:
      1,

    labels: {
      de: "Niederschlag",
      en: "Precipitation",
      it: "Precipitazioni",
    },

    aliases: [
      LEGACY_ENTITY.rainTotal,
    ],
  },


  sunshineTotal: {
    canonical:
      "weather.sunshine_duration_total",

    kind:
      "counter",

    unit:
      " min",

    decimals:
      0,

    labels: {
      de: "Sonnenscheindauer",
      en: "Sunshine Duration",
      it: "Durata Sole",
    },

    aliases: [
      LEGACY_ENTITY.sunshineTotal,
    ],
  },


  greenhouseHeaterEnergy: {
    canonical:
      "greenhouse.heater_energy",

    kind:
      "counter",

    unit:
      " kWh",

    decimals:
      2,

    labels: {
      de: "Heizenergie (Gewächshaus)",
      en: "Heating Energy (Greenhouse)",
      it: "Energia Riscaldamento (Serra)",
    },

    aliases: [
      LEGACY_ENTITY
        .greenhouseHeaterEnergy,
    ],
  },
} satisfies Record<
  string,
  MetricDefinition
>;


const TEMP_STATS_KEYS = [
  "outdoorTemperature",
  "northTemperature",
  "southTemperature",
  "eastTemperature",
  "westTemperature",
  "greenhouseTemperature",
  "windSpeed",
  "humidity",
  "sunshineTotal",
  "greenhouseHeaterEnergy",
] as const;


export function tempStatsEntityLabels(
  lang: BurgLanguage,
): Record<
  string,
  {
    name: string;
    unit: string;
  }
> {
  const result: Record<
    string,
    {
      name: string;
      unit: string;
    }
  > = {};

  for (
    const key
    of TEMP_STATS_KEYS
  ) {
    const metric =
      METRICS[key];

    for (
      const alias
      of metric.aliases
    ) {
      result[alias] = {
        name:
          metric.labels[lang],

        unit:
          metric.unit,
      };
    }
  }

  return result;
}


export function luxStatsEntityLabels(
  lang: BurgLanguage,
): Record<
  string,
  {
    name: string;
    unit: string;
  }
> {
  const metric =
    METRICS.illumination;

  return {
    [LEGACY_ENTITY.illumination]: {
      name:
        metric.labels[lang],

      unit:
        metric.unit,
    },
  };
}
