/* eslint-disable camelcase */
import http from 'http';

/**
 * Authorization status codes from ATAG One thermostat
 */
export enum AuthStatus {
  NOT_AVAILABLE = 0,
  PENDING = 1,
  GRANTED = 2,
  DENIED = 3,
}

/**
 * Info flags for retrieve message
 */
export enum MessageInfo {
  CONTROL = 1,
  SCHEDULES = 2,
  CONFIGURATION = 4,
  REPORT = 8,
  STATUS = 16,
  WIFI = 32,
  DETAILS = 64,
}

/**
 * Response from retrieve endpoint
 */
export interface RetrieveResponse {
  retrieve_reply?: {
    seqnr?: number;
    status?: {
      device_id?: string;
      device_status?: number;
      connection_status?: number;
      date_time?: number;
    };
    report?: {
      report_time?: number;
      burning_hours?: number;
      device_errors?: string;
      boiler_errors?: string;
      room_temp?: number;
      outside_temp?: number;
      dbg_outside_temp?: number;
      pcb_temp?: number;
      ch_setpoint?: number;
      dhw_water_temp?: number;
      ch_water_temp?: number;
      dhw_water_pres?: number;
      ch_water_pres?: number;
      ch_return_temp?: number;
      boiler_status?: number;
      boiler_config?: number;
      ch_time_to_temp?: number;
      shown_set_temp?: number;
      power_cons?: number;
      tout_avg?: number;
      rssi?: number;
      current?: number;
      voltage?: number;
      charge_status?: number;
      lmuc_burner_starts?: number;
      dhw_flow_rate?: number;
      resets?: number;
      memory_allocation?: number;
      details?: {
        rel_mod_level?: number;
      };
    };
    configuration?: {
      download_url?: string;
      temp_unit?: number;
      dhw_max_set?: number;
      dhw_min_set?: number;
    };
    control?: {
      ch_status?: number;
      ch_control_mode?: number;
      ch_mode?: number;
      ch_mode_duration?: number;
      ch_mode_temp?: number;
      dhw_temp_setp?: number;
      dhw_status?: number;
      dhw_mode?: number;
      dhw_mode_temp?: number;
      weather_temp?: number;
      weather_status?: number;
      vacation_duration?: number;
      extend_duration?: number;
      fireplace_duration?: number;
    };
    acc_status?: number;
  };
}

/**
 * Pair response from thermostat
 */
export interface PairResponse {
  pair_reply?: {
    seqnr?: number;
    acc_status?: number;
  };
}

/**
 * Update response from thermostat
 */
export interface UpdateResponse {
  update_reply?: {
    seqnr?: number;
    acc_status?: number;
  };
}

/**
 * Thermostat data
 */
export interface ThermostatData {
  deviceId?: string;
  apiVersion?: string;
  roomTemperature?: number;
  targetTemperature?: number;
  outsideTemperature?: number;
  averageOutsideTemperature?: number;
  weatherStatus?: string;
  waterPressure?: number;
  chWaterTemperature?: number;
  chReturnTemperature?: number;
  dhwWaterTemperature?: number;
  burningHours?: number;
  flameLevel?: number;
  centralHeatingActive?: boolean;
  burnerActive?: boolean;
  hotWaterActive?: boolean;
  heatingMode?: string;
  presetMode?: string;
  presetModeDuration?: string;
  dhwMode?: string;
  dhwTargetTemperature?: number;
  dhwMinTemperature?: number;
  dhwMaxTemperature?: number;
}

/**
 * Connection settings for ATAG One
 */
export interface ConnectionSettings {
  ipAddress: string;
  macAddress: string;
  deviceName: string;
  email: string;
}

/**
 * ATAG One API client for local network communication
 */
export class AtagOneApi {
  private static readonly PORT = 10000;
  private static readonly TIMEOUT = 10000;
  private static readonly PAIR_TIMEOUT = 30000;
  private static readonly MIN_TEMP = 4;
  private static readonly MAX_TEMP = 27;

  private ipAddress: string;
  private macAddress: string;
  private deviceName: string;
  private email: string;

  private static readonly HEATING_MODE_MAP: Record<number, string> = {
    0: 'heat',
    1: 'auto',
  };

  private static readonly PRESET_MODE_MAP: Record<number, string> = {
    1: 'manual',
    2: 'automatic',
    3: 'vacation',
    4: 'extend',
    5: 'fireplace',
  };

  private static readonly DHW_MODE_MAP: Record<number, string> = {
    0: 'performance',
    1: 'eco',
  };

  private static readonly WEATHER_STATUS_MAP: Record<number, string> = {
    0: 'sunny',
    1: 'clear',
    2: 'rainy',
    3: 'snowy',
    4: 'hail',
    5: 'windy',
    6: 'misty',
    7: 'cloudy',
    8: 'partly_sunny',
    9: 'partly_cloudy',
    10: 'shower',
    11: 'lightning',
    12: 'hurricane',
    13: 'unknown',
  };

  constructor(settings: ConnectionSettings) {
    this.ipAddress = settings.ipAddress;
    this.macAddress = this.normalizeMacAddress(settings.macAddress);
    this.deviceName = settings.deviceName;
    this.email = settings.email;
  }

  /**
   * Normalize MAC address to format without colons/dashes
   */
  private normalizeMacAddress(mac: string): string {
    return mac.replace(/[:-]/g, '').toUpperCase();
  }

  /**
   * Update connection settings
   */
  public updateSettings(settings: Partial<ConnectionSettings>): void {
    if (settings.ipAddress) this.ipAddress = settings.ipAddress;
    if (settings.macAddress) this.macAddress = this.normalizeMacAddress(settings.macAddress);
    if (settings.deviceName) this.deviceName = settings.deviceName;
    if (settings.email) this.email = settings.email;
  }

  /**
   * Make HTTP POST request to thermostat
   */
  private async request<T>(path: string, data: object, timeoutMs: number = AtagOneApi.TIMEOUT): Promise<T> {
    return new Promise((resolve, reject) => {
      const jsonData = JSON.stringify(data);

      const options: http.RequestOptions = {
        hostname: this.ipAddress,
        port: AtagOneApi.PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonData),
        },
        timeout: timeoutMs,
      };

      const req = http.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(body) as T;
            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Connection error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(jsonData);
      req.end();
    });
  }

  /**
   * Send pair/authorization request to thermostat
   * User must press "Yes" on the thermostat to authorize
   */
  public async pair(timeoutMs: number = AtagOneApi.PAIR_TIMEOUT): Promise<AuthStatus> {
    const pairMessage = {
      pair_message: {
        seqnr: 1,
        account_auth: {
          user_account: this.email,
          mac_address: this.macAddress,
        },
        accounts: {
          entries: [
            {
              user_account: this.email,
              mac_address: this.macAddress,
              device_name: this.deviceName,
              account_type: 0, // 0 = user, 1 = service
            },
          ],
        },
      },
    };

    const response = await this.request<PairResponse>('/pair_message', pairMessage, timeoutMs);

    if (response.pair_reply?.acc_status !== undefined) {
      return response.pair_reply.acc_status as AuthStatus;
    }

    throw new Error('Invalid pair response');
  }

  /**
   * Poll authorization status until granted, denied, or timeout
   */
  public async waitForAuthorization(
    maxAttempts: number = 3,
    intervalMs: number = 2000,
    requestTimeoutMs: number = AtagOneApi.PAIR_TIMEOUT,
    onStatus?: (status: AuthStatus, attempt: number, totalAttempts: number) => void,
  ): Promise<AuthStatus> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let status: AuthStatus;

      try {
        status = await this.pair(requestTimeoutMs);
      } catch (error) {
        if (error instanceof Error && error.message === 'Request timeout') {
          status = AuthStatus.PENDING;
        } else {
          throw error;
        }
      }

      if (onStatus) {
        onStatus(status, attempt + 1, maxAttempts);
      }

      if (status === AuthStatus.GRANTED) {
        return status;
      }

      if (status === AuthStatus.DENIED) {
        return status;
      }

      // Wait before next attempt
      // eslint-disable-next-line homey-app/global-timers
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('Authorization timeout');
  }

  /**
   * Retrieve data from thermostat
   */
  public async retrieve(infoFlags: number = MessageInfo.CONTROL | MessageInfo.REPORT): Promise<RetrieveResponse> {
    const retrieveMessage = {
      retrieve_message: {
        seqnr: 1,
        account_auth: {
          user_account: this.email,
          mac_address: this.macAddress,
        },
        info: infoFlags,
      },
    };

    return this.request<RetrieveResponse>('/retrieve', retrieveMessage);
  }

  /**
   * Get thermostat data (temperature, status, etc.)
   */
  public async getData(): Promise<ThermostatData> {
    const response = await this.retrieve(
      MessageInfo.CONTROL
      | MessageInfo.CONFIGURATION
      | MessageInfo.REPORT
      | MessageInfo.STATUS
      | MessageInfo.DETAILS,
    );
    const reply = response.retrieve_reply;

    if (!reply) {
      throw new Error('Invalid retrieve response');
    }

    // Check authorization status
    if (reply.acc_status === AuthStatus.DENIED) {
      throw new Error('Authorization denied. Please re-pair the device.');
    }

    if (reply.acc_status === AuthStatus.PENDING) {
      throw new Error('Authorization pending. Please approve on thermostat.');
    }

    const boilerStatus = reply.report?.boiler_status ?? 0;
    const centralHeatingActive = (boilerStatus & 2) !== 0;
    const hotWaterActive = (boilerStatus & 4) !== 0;
    const burnerActive = (boilerStatus & 8) !== 0;

    // Outside temperature: prefer weather_temp (from weather service), fall back to outside_temp sensor
    const outsideTemp = reply.control?.weather_temp ?? reply.report?.outside_temp;
    const rawDhwModeTemp = reply.control?.dhw_mode_temp;
    const dhwModeTemperature = rawDhwModeTemp !== undefined ? rawDhwModeTemp % 150 : undefined;

    return {
      deviceId: reply.status?.device_id,
      apiVersion: reply.configuration?.download_url?.split('/').pop(),
      roomTemperature: reply.report?.room_temp,
      targetTemperature: reply.control?.ch_mode_temp,
      outsideTemperature: outsideTemp,
      averageOutsideTemperature: reply.report?.tout_avg,
      weatherStatus: reply.control?.weather_status !== undefined
        ? AtagOneApi.WEATHER_STATUS_MAP[reply.control.weather_status]
        : undefined,
      waterPressure: reply.report?.ch_water_pres,
      chWaterTemperature: reply.report?.ch_water_temp,
      chReturnTemperature: reply.report?.ch_return_temp,
      dhwWaterTemperature: reply.report?.dhw_water_temp,
      burningHours: reply.report?.burning_hours,
      flameLevel: reply.report?.details?.rel_mod_level,
      centralHeatingActive,
      burnerActive,
      hotWaterActive,
      heatingMode: reply.control?.ch_control_mode !== undefined
        ? AtagOneApi.HEATING_MODE_MAP[reply.control.ch_control_mode]
        : undefined,
      presetMode: reply.control?.ch_mode !== undefined
        ? AtagOneApi.PRESET_MODE_MAP[reply.control.ch_mode]
        : undefined,
      presetModeDuration: reply.control?.ch_mode_duration !== undefined
        ? this.formatDuration(reply.control.ch_mode_duration)
        : undefined,
      dhwMode: hotWaterActive
        ? AtagOneApi.DHW_MODE_MAP[reply.control?.dhw_mode ?? -1]
        : 'off',
      dhwTargetTemperature: hotWaterActive ? reply.control?.dhw_temp_setp : dhwModeTemperature,
      dhwMinTemperature: reply.configuration?.dhw_min_set,
      dhwMaxTemperature: reply.configuration?.dhw_max_set,
    };
  }

  private formatDuration(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    return [hours, minutes, seconds]
      .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
      .join(':');
  }

  private normalizeHeatingMode(mode: string): number {
    const normalizedMode = mode.trim().toLowerCase();

    if (normalizedMode === 'heat') {
      return 0;
    }

    if (normalizedMode === 'auto') {
      return 1;
    }

    throw new Error(`Unsupported heating mode: ${mode}`);
  }

  private normalizePresetMode(mode: string): number {
    const normalizedMode = mode.trim().toLowerCase();
    const invertedPresetModeMap = Object.fromEntries(
      Object.entries(AtagOneApi.PRESET_MODE_MAP).map(([key, value]) => [value.toLowerCase(), Number(key)]),
    );
    const presetMode = invertedPresetModeMap[normalizedMode];

    if (presetMode !== undefined) {
      return presetMode;
    }

    throw new Error(`Unsupported preset mode: ${mode}`);
  }

  private normalizeDhwTargetTemperature(temperature: number): number {
    return Math.max(40, Math.min(65, Math.round(temperature)));
  }

  private async updateControl(
    control: Record<string, number>,
    configuration: Record<string, number> = {},
  ): Promise<void> {
    const updateMessage = {
      update_message: {
        seqnr: 1,
        account_auth: {
          user_account: this.email,
          mac_address: this.macAddress,
        },
        control,
        configuration,
      },
    };

    const response = await this.request<UpdateResponse>('/update', updateMessage);

    if (response.update_reply?.acc_status === AuthStatus.DENIED) {
      throw new Error('Authorization denied. Please re-pair the device.');
    }

    if (response.update_reply?.acc_status === AuthStatus.PENDING) {
      throw new Error('Authorization pending. Please approve on thermostat.');
    }
  }

  /**
   * Set target temperature
   * Temperature must be between 4 and 27°C, rounded to 0.5° increments
   */
  public async setTargetTemperature(temperature: number): Promise<void> {
    // Validate and round temperature
    let temp = Math.round(temperature * 2) / 2; // Round to 0.5
    temp = Math.max(AtagOneApi.MIN_TEMP, Math.min(AtagOneApi.MAX_TEMP, temp));

    await this.updateControl({
      ch_mode_temp: temp,
    });
  }

  public async setHeatingMode(mode: string): Promise<void> {
    await this.updateControl({
      ch_control_mode: this.normalizeHeatingMode(mode),
    });
  }

  public async setPresetMode(mode: string): Promise<void> {
    const presetMode = this.normalizePresetMode(mode);
    const control: Record<string, number> = {
      ch_mode: presetMode,
    };
    const configuration: Record<string, number> = {};

    if (presetMode === 3) {
      control.vacation_duration = 24 * 60 * 60;
      configuration.start_vacation = Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 1000);
    }

    await this.updateControl(control, configuration);
  }

  public async setDhwTargetTemperature(temperature: number): Promise<void> {
    await this.updateControl({
      dhw_temp_setp: this.normalizeDhwTargetTemperature(temperature),
    });
  }

  /**
   * Test connection to thermostat
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.retrieve(MessageInfo.STATUS);
      return true;
    } catch (error) {
      return false;
    }
  }
}
