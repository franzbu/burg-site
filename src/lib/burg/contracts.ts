export type NullableNumber =
  number | null;


export interface HistoryPoint {
  start: string;
  mean: NullableNumber;
  min: NullableNumber;
  max: NullableNumber;
}


export interface TemperatureHistoryResponse {
  entity: string;
  daily: HistoryPoint[];
  monthly: HistoryPoint[];
  hourly: HistoryPoint[];
}


export interface WeatherStationStatus {
  temp: NullableNumber;
  temp_min: NullableNumber;
  temp_max: NullableNumber;

  hum: NullableNumber;
  wind: NullableNumber;
  wind_direction: NullableNumber;
  lux: NullableNumber;

  rain_today: NullableNumber;
  rain_yesterday: NullableNumber;
  sunshine_duration: NullableNumber;

  is_raining: boolean | null;
  is_stormy: boolean | null;
}


export interface BurgStatusResponse {
  weather_station:
    WeatherStationStatus;

  house_north: {
    temp: NullableNumber;
  };

  house_south: {
    temp: NullableNumber;
  };

  house_east: {
    temp: NullableNumber;
  };

  house_west: {
    temp: NullableNumber;
  };

  greenhouse: {
    temp: NullableNumber;
    temp_min: NullableNumber;
    temp_max: NullableNumber;
    watchdog_active: boolean | null;
    heater_energy: NullableNumber;
    heater_energy_today: NullableNumber;
  };

  irrigation: {
    today: NullableNumber;
    yesterday: NullableNumber;
    is_active: boolean | null;
  };

  daily_rain_14d:
    Array<{
      date: string;
      value: NullableNumber;
    }>;

  historical_rain:
    Record<
      string,
      Record<
        string,
        NullableNumber
      >
    >;

  daily_irr_14d:
    Array<{
      date: string;
      value: NullableNumber;
    }>;

  historical_irr:
    Record<
      string,
      Record<
        string,
        NullableNumber
      >
    >;

  daily_acute_rain_15d:
    Array<{
      date: string;
      minutes: number;
      percentage: number;
    }>;

  historical_acute_rain:
    Record<
      string,
      Record<
        string,
        {
          minutes: number;
          percentage: number;
        } | null
      >
    >;

  hourly_acute_rain_24h:
    Array<{
      start: string;
      minutes: number;
    }>;
}
