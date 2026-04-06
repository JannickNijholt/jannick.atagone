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
  roomTemperature?: number;
  targetTemperature?: number;
  outsideTemperature?: number;
  waterPressure?: number;
  boilerHeating?: boolean;
  hotWaterActive?: boolean;
  flameOn?: boolean;
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
  private static readonly MIN_TEMP = 4;
  private static readonly MAX_TEMP = 27;

  private ipAddress: string;
  private macAddress: string;
  private deviceName: string;
  private email: string;

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
  private async request<T>(path: string, data: object): Promise<T> {
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
        timeout: AtagOneApi.TIMEOUT,
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
  public async pair(): Promise<AuthStatus> {
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

    const response = await this.request<PairResponse>('/pair_message', pairMessage);

    if (response.pair_reply?.acc_status !== undefined) {
      return response.pair_reply.acc_status as AuthStatus;
    }

    throw new Error('Invalid pair response');
  }

  /**
   * Poll authorization status until granted, denied, or timeout
   */
  public async waitForAuthorization(
    maxAttempts: number = 30,
    intervalMs: number = 2000,
    onStatus?: (status: AuthStatus) => void,
  ): Promise<AuthStatus> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.pair();

      if (onStatus) {
        onStatus(status);
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
    const response = await this.retrieve(MessageInfo.CONTROL | MessageInfo.REPORT | MessageInfo.STATUS);
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

    // Outside temperature: prefer weather_temp (from weather service), fall back to outside_temp sensor
    const outsideTemp = reply.control?.weather_temp ?? reply.report?.outside_temp;

    return {
      deviceId: reply.status?.device_id,
      roomTemperature: reply.report?.room_temp,
      targetTemperature: reply.control?.ch_mode_temp,
      outsideTemperature: outsideTemp,
      waterPressure: reply.report?.ch_water_pres,
      boilerHeating: (boilerStatus & 8) !== 0, // CH heating
      hotWaterActive: (boilerStatus & 4) !== 0, // DHW active
      flameOn: (boilerStatus & 8) !== 0 || (boilerStatus & 4) !== 0,
    };
  }

  /**
   * Set target temperature
   * Temperature must be between 4 and 27°C, rounded to 0.5° increments
   */
  public async setTargetTemperature(temperature: number): Promise<void> {
    // Validate and round temperature
    let temp = Math.round(temperature * 2) / 2; // Round to 0.5
    temp = Math.max(AtagOneApi.MIN_TEMP, Math.min(AtagOneApi.MAX_TEMP, temp));

    const updateMessage = {
      update_message: {
        seqnr: 1,
        account_auth: {
          user_account: this.email,
          mac_address: this.macAddress,
        },
        control: {
          ch_mode_temp: temp,
        },
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
