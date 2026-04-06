/* eslint-disable camelcase, import/extensions, import/no-unresolved, node/no-missing-import */
import Homey from 'homey';
import { AtagOneApi, ThermostatData } from '../../lib/AtagOneApi';

interface DeviceSettings {
  ip_address: string;
  mac_address: string;
  device_name: string;
  email: string;
  poll_interval: number;
  offline_retry_threshold: number;
}

module.exports = class AtagOneDevice extends Homey.Device {

  private api!: AtagOneApi;
  private pollInterval?: ReturnType<typeof setInterval>;
  private boostTimeout?: ReturnType<typeof setTimeout>;
  private previousTemperature?: number;
  private consecutivePollFailures = 0;

  // Flow card references
  private temperatureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private targetTemperatureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private pressureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private pressureTooLowTrigger!: Homey.FlowCardTriggerDevice;
  private boilerStartedTrigger!: Homey.FlowCardTriggerDevice;
  private boilerStoppedTrigger!: Homey.FlowCardTriggerDevice;

  // Previous values for change detection
  private prevRoomTemp?: number;
  private prevTargetTemp?: number;
  private prevPressure?: number;
  private prevBoilerHeating?: boolean;

  async onInit() {
    this.log('AtagOneDevice has been initialized');

    // Get settings
    const settings = this.getSettings() as DeviceSettings;

    // Initialize API client
    this.api = new AtagOneApi({
      ipAddress: settings.ip_address,
      macAddress: settings.mac_address,
      deviceName: settings.device_name,
      email: settings.email,
    });

    // Add capabilities that may not exist on older paired devices
    await this.ensureCapabilities();

    // Register flow cards
    await this.registerFlowCards();

    // Register capability listeners
    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.log('Setting target temperature to:', value);
      try {
        await this.api.setTargetTemperature(value);
        this.log('Target temperature set successfully');
      } catch (error) {
        this.error('Failed to set target temperature:', error);
        throw error;
      }
    });

    // Start polling
    this.startPolling(settings.poll_interval);

    // Initial data fetch
    await this.pollData();
  }

  private async ensureCapabilities() {
    const requiredCapabilities = ['measure_pressure', 'alarm_generic.boiler', 'outside_temperature'];

    for (const capability of requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
        this.log(`Added ${capability} capability`);
      }
    }
  }

  private async registerFlowCards() {
    // Triggers
    this.temperatureChangedTrigger = this.homey.flow.getDeviceTriggerCard('temperature_changed');
    this.targetTemperatureChangedTrigger = this.homey.flow.getDeviceTriggerCard('target_temperature_changed');
    this.pressureChangedTrigger = this.homey.flow.getDeviceTriggerCard('pressure_changed');
    this.pressureTooLowTrigger = this.homey.flow.getDeviceTriggerCard('pressure_too_low');
    this.boilerStartedTrigger = this.homey.flow.getDeviceTriggerCard('boiler_started');
    this.boilerStoppedTrigger = this.homey.flow.getDeviceTriggerCard('boiler_stopped');

    // Register run listener for pressure_too_low (has threshold argument)
    this.pressureTooLowTrigger.registerRunListener(async (args, state) => {
      return state.pressure < args.threshold;
    });

    // Conditions
    const temperatureAboveCondition = this.homey.flow.getConditionCard('temperature_above');
    temperatureAboveCondition.registerRunListener(async (args) => {
      const currentTemp = this.getCapabilityValue('measure_temperature');
      return currentTemp > args.temperature;
    });

    const boilerHeatingCondition = this.homey.flow.getConditionCard('boiler_heating');
    boilerHeatingCondition.registerRunListener(async (args) => {
      const isHeating = this.getCapabilityValue('alarm_generic.boiler');
      return isHeating === true;
    });

    const pressureAboveCondition = this.homey.flow.getConditionCard('pressure_above');
    pressureAboveCondition.registerRunListener(async (args) => {
      const currentPressure = this.getCapabilityValue('measure_pressure');
      // Convert mbar back to bar for comparison
      return (currentPressure / 1000) > args.pressure;
    });

    // Actions
    const setTemperatureAction = this.homey.flow.getActionCard('set_temperature');
    setTemperatureAction.registerRunListener(async (args) => {
      this.log('Flow action: Setting temperature to', args.temperature);
      await this.api.setTargetTemperature(args.temperature);
      await this.setCapabilityValue('target_temperature', args.temperature);
    });

    const setTemperatureDurationAction = this.homey.flow.getActionCard('set_temperature_duration');
    setTemperatureDurationAction.registerRunListener(async (args) => {
      this.log('Flow action: Setting temperature to', args.temperature, 'for', args.duration, 'minutes');

      // Store previous temperature to restore later
      this.previousTemperature = this.getCapabilityValue('target_temperature');

      // Set new temperature
      await this.api.setTargetTemperature(args.temperature);
      await this.setCapabilityValue('target_temperature', args.temperature);

      // Clear any existing boost timeout
      if (this.boostTimeout) {
        clearTimeout(this.boostTimeout);
      }

      // Set timeout to restore previous temperature
      const durationMs = args.duration * 60 * 1000;
      // eslint-disable-next-line homey-app/global-timers
      this.boostTimeout = setTimeout(() => {
        this.restorePreviousTemperature().catch((error) => {
          this.error('Failed to restore previous temperature:', error);
        });
      }, durationMs);
    });
  }

  async onAdded() {
    this.log('AtagOneDevice has been added');
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('AtagOneDevice settings where changed:', changedKeys);

    // Update API settings if connection settings changed
    if (changedKeys.includes('ip_address') || changedKeys.includes('device_name') || changedKeys.includes('email')) {
      this.api.updateSettings({
        ipAddress: newSettings.ip_address as string,
        deviceName: newSettings.device_name as string,
        email: newSettings.email as string,
      });
    }

    // Restart polling if interval changed
    if (changedKeys.includes('poll_interval')) {
      this.startPolling(newSettings.poll_interval as number);
    }

    if (changedKeys.includes('offline_retry_threshold')) {
      this.log('Offline retry threshold updated to:', newSettings.offline_retry_threshold);
    }
  }

  async onRenamed(name: string) {
    this.log('AtagOneDevice was renamed to:', name);
  }

  async onDeleted() {
    this.log('AtagOneDevice has been deleted');
    this.stopPolling();

    if (this.boostTimeout) {
      clearTimeout(this.boostTimeout);
    }
  }

  private startPolling(intervalSeconds: number) {
    this.stopPolling();
    const intervalMs = intervalSeconds * 1000;
    this.log('Starting polling with interval:', intervalMs, 'ms');
    // eslint-disable-next-line homey-app/global-timers
    this.pollInterval = setInterval(() => {
      this.pollData().catch((error) => {
        this.error('Polling interval handler failed:', error);
      });
    }, intervalMs);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      this.log('Polling stopped');
    }
  }

  private async pollData() {
    const settings = this.getSettings() as DeviceSettings;
    const offlineRetryThreshold = Math.max(1, settings.offline_retry_threshold ?? 10);

    try {
      this.log('Polling thermostat data...');
      const data = await this.api.getData();
      this.log('Received data:', data);

      this.consecutivePollFailures = 0;

      // Update capabilities and trigger flows
      await this.updateCapabilitiesAndTriggerFlows(data);

      // Clear any previous unavailable state
      if (this.getAvailable() === false) {
        await this.setAvailable();
      }
    } catch (error) {
      this.error('Failed to poll thermostat:', error);
      this.consecutivePollFailures += 1;

      if (this.consecutivePollFailures >= offlineRetryThreshold) {
        await this.setUnavailable(
          `Connection failed after ${this.consecutivePollFailures} consecutive attempts`,
        );
      } else {
        this.log(
          'Keeping device available after failed poll attempt',
          this.consecutivePollFailures,
          'of',
          offlineRetryThreshold,
        );
      }
    }
  }

  private async restorePreviousTemperature() {
    if (this.previousTemperature === undefined) {
      return;
    }

    this.log('Boost mode ended, restoring temperature to', this.previousTemperature);
    await this.api.setTargetTemperature(this.previousTemperature);
    await this.setCapabilityValue('target_temperature', this.previousTemperature);
  }

  private async updateCapabilitiesAndTriggerFlows(data: ThermostatData) {
    // Room temperature
    if (data.roomTemperature !== undefined) {
      await this.setCapabilityValue('measure_temperature', data.roomTemperature);

      if (this.prevRoomTemp !== undefined && this.prevRoomTemp !== data.roomTemperature) {
        await this.temperatureChangedTrigger.trigger(this, { temperature: data.roomTemperature });
      }
      this.prevRoomTemp = data.roomTemperature;
    }

    // Target temperature
    if (data.targetTemperature !== undefined) {
      await this.setCapabilityValue('target_temperature', data.targetTemperature);

      if (this.prevTargetTemp !== undefined && this.prevTargetTemp !== data.targetTemperature) {
        await this.targetTemperatureChangedTrigger.trigger(this, { temperature: data.targetTemperature });
      }
      this.prevTargetTemp = data.targetTemperature;
    }

    // Outside temperature
    if (data.outsideTemperature !== undefined) {
      this.log('Setting outside temperature:', data.outsideTemperature);
      await this.setCapabilityValue('outside_temperature', data.outsideTemperature);
    } else {
      this.log('Outside temperature not available from thermostat');
    }

    // Water pressure
    if (data.waterPressure !== undefined) {
      const pressureMbar = data.waterPressure * 1000; // Convert bar to mbar
      await this.setCapabilityValue('measure_pressure', pressureMbar);

      if (this.prevPressure !== undefined && this.prevPressure !== data.waterPressure) {
        await this.pressureChangedTrigger.trigger(this, { pressure: data.waterPressure });

        // Trigger pressure too low (pass state, let run listener filter by threshold)
        await this.pressureTooLowTrigger.trigger(this, { pressure: data.waterPressure }, { pressure: data.waterPressure });
      }
      this.prevPressure = data.waterPressure;
    }

    // Boiler heating status
    if (data.boilerHeating !== undefined) {
      await this.setCapabilityValue('alarm_generic.boiler', data.boilerHeating);

      if (this.prevBoilerHeating !== undefined && this.prevBoilerHeating !== data.boilerHeating) {
        if (data.boilerHeating) {
          await this.boilerStartedTrigger.trigger(this);
        } else {
          await this.boilerStoppedTrigger.trigger(this);
        }
      }
      this.prevBoilerHeating = data.boilerHeating;
    }
  }

};
