/* eslint-disable camelcase, import/extensions, import/no-unresolved, node/no-missing-import */
import Homey from 'homey';
import { AtagOneApi, AuthStatus } from '../../lib/AtagOneApi';

interface PairingData {
  ipAddress: string;
  macAddress: string;
  deviceName: string;
  email: string;
}

interface PairingProgress {
  state: 'idle' | 'running' | 'success' | 'error';
  attempt: number;
  totalAttempts: number;
  status: AuthStatus | null;
  message: string;
}

module.exports = class AtagOneDriver extends Homey.Driver {
  private static readonly PAIR_MAX_ATTEMPTS = 5;
  private static readonly PAIR_RETRY_INTERVAL_MS = 1000;
  private static readonly PAIR_REQUEST_TIMEOUT_MS = 18000;

  private pairingData: PairingData = {
    ipAddress: '',
    macAddress: '',
    deviceName: '',
    email: '',
  };

  async onInit() {
    this.log('AtagOneDriver has been initialized');
  }

  async onPair(session: Homey.Driver.PairSession) {
    this.log('Pairing session started');

    let pairingProgress: PairingProgress = {
      state: 'idle',
      attempt: 0,
      totalAttempts: AtagOneDriver.PAIR_MAX_ATTEMPTS,
      status: null,
      message: 'Waiting to start pairing.',
    };

    // Reset pairing data
    this.pairingData = {
      ipAddress: '',
      macAddress: '',
      deviceName: '',
      email: '',
    };

    // Log when view changes
    session.setHandler('showView', async (viewId: string) => {
      this.log('Showing view:', viewId);
    });

    session.setHandler('get_pair_progress', async () => pairingProgress);

    // Handle configure event from custom view
    session.setHandler('configure', async (data: PairingData) => {
      this.log('Received configuration data:', data);

      this.pairingData = {
        ipAddress: data.ipAddress,
        macAddress: data.macAddress,
        deviceName: data.deviceName,
        email: data.email,
      };

      // Create API instance and attempt authorization
      const api = new AtagOneApi({
        ipAddress: this.pairingData.ipAddress,
        macAddress: this.pairingData.macAddress,
        deviceName: this.pairingData.deviceName,
        email: this.pairingData.email,
      });

      try {
        pairingProgress = {
          state: 'running',
          attempt: 1,
          totalAttempts: AtagOneDriver.PAIR_MAX_ATTEMPTS,
          status: null,
          message: 'Connecting to the thermostat. Please press YES on your ATAG One when prompted.',
        };

        this.log('Starting authorization flow; waiting for thermostat approval...');
        const status = await api.waitForAuthorization(
          AtagOneDriver.PAIR_MAX_ATTEMPTS,
          AtagOneDriver.PAIR_RETRY_INTERVAL_MS,
          AtagOneDriver.PAIR_REQUEST_TIMEOUT_MS,
          (currentStatus, attempt, totalAttempts) => {
            let message = `Attempt ${attempt}/${totalAttempts}: waiting for confirmation on the thermostat.`;

            if (currentStatus === AuthStatus.GRANTED) {
              message = `Attempt ${attempt}/${totalAttempts}: authorization granted.`;
            } else if (currentStatus === AuthStatus.DENIED) {
              message = `Attempt ${attempt}/${totalAttempts}: authorization denied on the thermostat.`;
            }

            pairingProgress = {
              state: 'running',
              attempt,
              totalAttempts,
              status: currentStatus,
              message,
            };

            this.log('Pair request result:', currentStatus);
          },
        );

        if (status === AuthStatus.GRANTED) {
          pairingProgress = {
            state: 'success',
            attempt: pairingProgress.attempt,
            totalAttempts: pairingProgress.totalAttempts,
            status,
            message: 'Authorization granted. Preparing device setup.',
          };
          this.log('Authorization granted!');
          return {
            success: true,
            attempt: pairingProgress.attempt,
            totalAttempts: pairingProgress.totalAttempts,
          };
        }

        if (status === AuthStatus.DENIED) {
          throw new Error('Authorization denied by thermostat');
        }

        throw new Error('Authorization is still pending. Please press YES on your ATAG One thermostat and try again.');
      } catch (error) {
        this.error('Pairing error:', error);

        if (error instanceof Error && error.message === 'Authorization timeout') {
          pairingProgress = {
            state: 'error',
            attempt: pairingProgress.totalAttempts,
            totalAttempts: pairingProgress.totalAttempts,
            status: AuthStatus.PENDING,
            message: `No confirmation received after ${pairingProgress.totalAttempts} attempts. Please press YES on your ATAG One thermostat and try again.`,
          };
          throw new Error('No confirmation received from the thermostat within 90 seconds. Please press YES on your ATAG One thermostat and try again.');
        }

        pairingProgress = {
          state: 'error',
          attempt: pairingProgress.attempt,
          totalAttempts: pairingProgress.totalAttempts,
          status: pairingProgress.status,
          message: error instanceof Error ? error.message : 'Pairing failed.',
        };

        throw error;
      }
    });

    // Handle list_devices view
    session.setHandler('list_devices', async () => {
      this.log('Listing devices for pairing');

      // Normalize MAC address for device ID
      const normalizedMac = this.pairingData.macAddress
        .replace(/[:-]/g, '')
        .toUpperCase();

      const devices = [{
        name: 'ATAG One 2.0',
        data: {
          id: normalizedMac,
        },
        settings: {
          ip_address: this.pairingData.ipAddress,
          mac_address: this.pairingData.macAddress,
          device_name: this.pairingData.deviceName,
          email: this.pairingData.email,
          poll_interval: 30,
          offline_retry_threshold: 10,
          temperature_write_retries_enabled: true,
          temperature_write_max_attempts: 5,
          temperature_write_retry_interval: 5,
          temperature_write_verify_enabled: true,
          temperature_write_verify_delay: 2,
        },
      }];

      this.log('Returning devices:', devices);
      return devices;
    });
  }

};
