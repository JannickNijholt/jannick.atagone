/* eslint-disable camelcase, import/extensions, import/no-unresolved, node/no-missing-import */
import Homey from 'homey';
import { AtagOneApi, AuthStatus } from '../../lib/AtagOneApi';

interface PairingData {
  ipAddress: string;
  macAddress: string;
  deviceName: string;
  email: string;
}

module.exports = class AtagOneDriver extends Homey.Driver {

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
        // Send pair request
        this.log('Sending pair request to thermostat...');
        const status = await api.pair();
        this.log('Pair request result:', status);

        if (status === AuthStatus.GRANTED) {
          this.log('Authorization granted!');
          return { success: true };
        }

        if (status === AuthStatus.DENIED) {
          throw new Error('Authorization denied by thermostat');
        }

        // Status is PENDING
        throw new Error('Please press YES on your ATAG One thermostat to authorize, then try again');
      } catch (error) {
        this.error('Pairing error:', error);
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
