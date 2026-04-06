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
  temperature_write_retries_enabled: boolean;
  temperature_write_max_attempts: number;
  temperature_write_retry_interval: number;
  temperature_write_verify_enabled: boolean;
  temperature_write_verify_delay: number;
}

module.exports = class AtagOneDevice extends Homey.Device {

  private api!: AtagOneApi;
  private pollInterval?: ReturnType<typeof setInterval>;
  private boostTimeout?: ReturnType<typeof setTimeout>;
  private previousTemperature?: number;
  private consecutivePollFailures = 0;
  private activeTemperatureWriteToken = 0;

  // Flow card references
  private temperatureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private targetTemperatureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private pressureChangedTrigger!: Homey.FlowCardTriggerDevice;
  private pressureTooLowTrigger!: Homey.FlowCardTriggerDevice;
  private boilerStartedTrigger!: Homey.FlowCardTriggerDevice;
  private boilerStoppedTrigger!: Homey.FlowCardTriggerDevice;
  private burnerStartedTrigger!: Homey.FlowCardTriggerDevice;
  private burnerStoppedTrigger!: Homey.FlowCardTriggerDevice;
  private hotWaterStartedTrigger!: Homey.FlowCardTriggerDevice;
  private hotWaterStoppedTrigger!: Homey.FlowCardTriggerDevice;
  private heatingModeChangedTrigger!: Homey.FlowCardTriggerDevice;
  private presetModeChangedTrigger!: Homey.FlowCardTriggerDevice;
  private dhwModeChangedTrigger!: Homey.FlowCardTriggerDevice;
  private flameLevelChangedTrigger!: Homey.FlowCardTriggerDevice;

  // Previous values for change detection
  private prevRoomTemp?: number;
  private prevTargetTemp?: number;
  private prevPressure?: number;
  private prevBoilerHeating?: boolean;
  private prevBurnerActive?: boolean;
  private prevHotWaterActive?: boolean;
  private prevHeatingMode?: string;
  private prevPresetMode?: string;
  private prevDhwMode?: string;
  private prevFlameLevel?: number;

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
        await this.setTargetTemperatureWithRetry(value, true);
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
    const requiredCapabilities = [
      'measure_pressure',
      'alarm_generic.boiler',
      'alarm_burner_active',
      'alarm_hot_water_active',
      'outside_temperature',
      'average_outside_temperature',
      'ch_water_temperature',
      'ch_return_temperature',
      'dhw_water_temperature',
      'dhw_target_temperature',
      'dhw_min_temperature',
      'dhw_max_temperature',
      'flame_level',
      'burning_hours',
      'weather_status',
      'heating_mode',
      'preset_mode',
      'preset_mode_duration',
      'dhw_mode',
      'api_version',
    ];

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
    this.burnerStartedTrigger = this.homey.flow.getDeviceTriggerCard('burner_started');
    this.burnerStoppedTrigger = this.homey.flow.getDeviceTriggerCard('burner_stopped');
    this.hotWaterStartedTrigger = this.homey.flow.getDeviceTriggerCard('hot_water_started');
    this.hotWaterStoppedTrigger = this.homey.flow.getDeviceTriggerCard('hot_water_stopped');
    this.heatingModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('heating_mode_changed');
    this.presetModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('preset_mode_changed');
    this.dhwModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('dhw_mode_changed');
    this.flameLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('flame_level_changed');

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

    const burnerActiveCondition = this.homey.flow.getConditionCard('burner_active');
    burnerActiveCondition.registerRunListener(async () => this.getCapabilityValue('alarm_burner_active') === true);

    const hotWaterActiveCondition = this.homey.flow.getConditionCard('hot_water_active');
    hotWaterActiveCondition.registerRunListener(async () => this.getCapabilityValue('alarm_hot_water_active') === true);

    const heatingModeCondition = this.homey.flow.getConditionCard('heating_mode_is');
    heatingModeCondition.registerRunListener(async (args) => {
      const currentMode = this.normalizeModeValue(this.getCapabilityValue('heating_mode'));
      return currentMode === this.normalizeModeValue(args.mode);
    });

    const presetModeCondition = this.homey.flow.getConditionCard('preset_mode_is');
    presetModeCondition.registerRunListener(async (args) => {
      const currentMode = this.normalizeModeValue(this.getCapabilityValue('preset_mode'));
      return currentMode === this.normalizeModeValue(args.mode);
    });

    const dhwModeCondition = this.homey.flow.getConditionCard('dhw_mode_is');
    dhwModeCondition.registerRunListener(async (args) => {
      const currentMode = this.normalizeModeValue(this.getCapabilityValue('dhw_mode'));
      return currentMode === this.normalizeModeValue(args.mode);
    });

    const flameLevelAboveCondition = this.homey.flow.getConditionCard('flame_level_above');
    flameLevelAboveCondition.registerRunListener(async (args) => {
      const flameLevel = this.getCapabilityValue('flame_level');
      return typeof flameLevel === 'number' && flameLevel > args.level;
    });

    // Actions
    const setTemperatureAction = this.homey.flow.getActionCard('set_temperature');
    setTemperatureAction.registerRunListener(async (args) => {
      this.log('Flow action: Setting temperature to', args.temperature);
      await this.setTargetTemperatureWithRetry(args.temperature, true);
    });

    const setTemperatureDurationAction = this.homey.flow.getActionCard('set_temperature_duration');
    setTemperatureDurationAction.registerRunListener(async (args) => {
      this.log('Flow action: Setting temperature to', args.temperature, 'for', args.duration, 'minutes');

      // Store previous temperature to restore later
      this.previousTemperature = this.getCapabilityValue('target_temperature');

      // Set new temperature
      await this.setTargetTemperatureWithRetry(args.temperature, true);

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

    const setHeatingModeAction = this.homey.flow.getActionCard('set_heating_mode');
    setHeatingModeAction.registerRunListener(async (args) => {
      const mode = this.normalizeModeValue(args.mode);
      this.log('Flow action: Setting heating mode to', mode);
      await this.api.setHeatingMode(mode);
      await this.pollData();
    });

    const setPresetModeAction = this.homey.flow.getActionCard('set_preset_mode');
    setPresetModeAction.registerRunListener(async (args) => {
      const mode = this.normalizeModeValue(args.mode);
      this.log('Flow action: Setting preset mode to', mode);
      await this.api.setPresetMode(mode);
      await this.pollData();
    });

    const setDhwTargetTemperatureAction = this.homey.flow.getActionCard('set_dhw_target_temperature');
    setDhwTargetTemperatureAction.registerRunListener(async (args) => {
      this.log('Flow action: Setting DHW target temperature to', args.temperature);
      await this.api.setDhwTargetTemperature(args.temperature);
      await this.pollData();
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
    await this.setTargetTemperatureWithRetry(this.previousTemperature, true);
  }

  private getTemperatureWriteSettings() {
    const settings = this.getSettings() as DeviceSettings;

    return {
      retriesEnabled: settings.temperature_write_retries_enabled ?? true,
      maxAttempts: Math.max(1, settings.temperature_write_max_attempts ?? 5),
      retryIntervalMs: Math.max(0, settings.temperature_write_retry_interval ?? 5) * 1000,
      verifyEnabled: settings.temperature_write_verify_enabled ?? true,
      verifyDelayMs: Math.max(0, settings.temperature_write_verify_delay ?? 2) * 1000,
    };
  }

  private normalizeTargetTemperature(temperature: number): number {
    const roundedTemperature = Math.round(temperature * 2) / 2;
    return Math.max(4, Math.min(27, roundedTemperature));
  }

  private async setTargetTemperatureWithRetry(
    temperature: number,
    updateCapabilityValue: boolean = false,
  ): Promise<void> {
    const targetTemperature = this.normalizeTargetTemperature(temperature);
    const writeSettings = this.getTemperatureWriteSettings();
    const maxAttempts = writeSettings.retriesEnabled ? writeSettings.maxAttempts : 1;
    const writeToken = ++this.activeTemperatureWriteToken;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.ensureActiveTemperatureWrite(writeToken);

        this.log(
          'Setting target temperature attempt',
          attempt,
          'of',
          maxAttempts,
          'to',
          targetTemperature,
        );

        await this.api.setTargetTemperature(targetTemperature);
        this.ensureActiveTemperatureWrite(writeToken);

        if (writeSettings.verifyEnabled) {
          if (writeSettings.verifyDelayMs > 0) {
            await this.delay(writeSettings.verifyDelayMs);
            this.ensureActiveTemperatureWrite(writeToken);
          }

          const data = await this.api.getData();
          this.ensureActiveTemperatureWrite(writeToken);
          if (data.targetTemperature !== targetTemperature) {
            throw new Error(
              `Verification failed: thermostat reports ${data.targetTemperature ?? 'unknown'}°C instead of ${targetTemperature}°C`,
            );
          }
        }

        if (updateCapabilityValue) {
          this.ensureActiveTemperatureWrite(writeToken);
          await this.setCapabilityValue('target_temperature', targetTemperature);
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable = this.isRetryableTemperatureWriteError(lastError);
        const hasAttemptsLeft = attempt < maxAttempts;

        this.error(`Temperature write attempt ${attempt}/${maxAttempts} failed:`, lastError);

        if (!retryable || !hasAttemptsLeft) {
          throw new Error(
            `Temperature could not be set to ${targetTemperature}°C after ${attempt} of ${maxAttempts} attempts: ${lastError.message}`,
          );
        }

        this.log('Retrying target temperature write in', writeSettings.retryIntervalMs, 'ms');
        await this.delay(writeSettings.retryIntervalMs);
      }
    }

    throw new Error(
      `Temperature could not be set to ${targetTemperature}°C after ${maxAttempts} attempts: ${lastError?.message ?? 'Unknown error'}`,
    );
  }

  private isRetryableTemperatureWriteError(error: Error): boolean {
    const message = error.message.toLowerCase();

    if (
      message.includes('authorization denied')
      || message.includes('authorization pending')
      || message.includes('verification failed')
      || message.includes('superseded by a newer temperature change')
    ) {
      return false;
    }

    return true;
  }

  private ensureActiveTemperatureWrite(writeToken: number): void {
    if (writeToken !== this.activeTemperatureWriteToken) {
      throw new Error('Temperature write superseded by a newer temperature change');
    }
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    // eslint-disable-next-line homey-app/global-timers
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeModeValue(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim().toLowerCase();
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

    if (data.averageOutsideTemperature !== undefined) {
      await this.setCapabilityValue('average_outside_temperature', data.averageOutsideTemperature);
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

    if (data.chWaterTemperature !== undefined) {
      await this.setCapabilityValue('ch_water_temperature', data.chWaterTemperature);
    }

    if (data.chReturnTemperature !== undefined) {
      await this.setCapabilityValue('ch_return_temperature', data.chReturnTemperature);
    }

    if (data.dhwWaterTemperature !== undefined) {
      await this.setCapabilityValue('dhw_water_temperature', data.dhwWaterTemperature);
    }

    if (data.dhwTargetTemperature !== undefined) {
      await this.setCapabilityValue('dhw_target_temperature', data.dhwTargetTemperature);
    }

    if (data.dhwMinTemperature !== undefined) {
      await this.setCapabilityValue('dhw_min_temperature', data.dhwMinTemperature);
    }

    if (data.dhwMaxTemperature !== undefined) {
      await this.setCapabilityValue('dhw_max_temperature', data.dhwMaxTemperature);
    }

    if (data.flameLevel !== undefined) {
      await this.setCapabilityValue('flame_level', data.flameLevel);

      if (this.prevFlameLevel !== undefined && this.prevFlameLevel !== data.flameLevel) {
        await this.flameLevelChangedTrigger.trigger(this, { level: data.flameLevel });
      }
      this.prevFlameLevel = data.flameLevel;
    }

    if (data.burningHours !== undefined) {
      await this.setCapabilityValue('burning_hours', data.burningHours);
    }

    if (data.weatherStatus !== undefined) {
      await this.setCapabilityValue('weather_status', data.weatherStatus);
    }

    if (data.heatingMode !== undefined) {
      await this.setCapabilityValue('heating_mode', data.heatingMode);

      if (this.prevHeatingMode !== undefined && this.prevHeatingMode !== data.heatingMode) {
        await this.heatingModeChangedTrigger.trigger(this, { mode: data.heatingMode });
      }
      this.prevHeatingMode = data.heatingMode;
    }

    if (data.presetMode !== undefined) {
      await this.setCapabilityValue('preset_mode', data.presetMode);

      if (this.prevPresetMode !== undefined && this.prevPresetMode !== data.presetMode) {
        await this.presetModeChangedTrigger.trigger(this, { mode: data.presetMode });
      }
      this.prevPresetMode = data.presetMode;
    }

    if (data.presetModeDuration !== undefined) {
      await this.setCapabilityValue('preset_mode_duration', data.presetModeDuration);
    }

    if (data.dhwMode !== undefined) {
      await this.setCapabilityValue('dhw_mode', data.dhwMode);

      if (this.prevDhwMode !== undefined && this.prevDhwMode !== data.dhwMode) {
        await this.dhwModeChangedTrigger.trigger(this, { mode: data.dhwMode });
      }
      this.prevDhwMode = data.dhwMode;
    }

    if (data.apiVersion !== undefined) {
      await this.setCapabilityValue('api_version', data.apiVersion);
    }

    if (data.burnerActive !== undefined) {
      await this.setCapabilityValue('alarm_burner_active', data.burnerActive);

      if (this.prevBurnerActive !== undefined && this.prevBurnerActive !== data.burnerActive) {
        if (data.burnerActive) {
          await this.burnerStartedTrigger.trigger(this);
        } else {
          await this.burnerStoppedTrigger.trigger(this);
        }
      }
      this.prevBurnerActive = data.burnerActive;
    }

    if (data.hotWaterActive !== undefined) {
      await this.setCapabilityValue('alarm_hot_water_active', data.hotWaterActive);

      if (this.prevHotWaterActive !== undefined && this.prevHotWaterActive !== data.hotWaterActive) {
        if (data.hotWaterActive) {
          await this.hotWaterStartedTrigger.trigger(this);
        } else {
          await this.hotWaterStoppedTrigger.trigger(this);
        }
      }
      this.prevHotWaterActive = data.hotWaterActive;
    }

    // Central heating status
    if (data.centralHeatingActive !== undefined) {
      await this.setCapabilityValue('alarm_generic.boiler', data.centralHeatingActive);

      if (this.prevBoilerHeating !== undefined && this.prevBoilerHeating !== data.centralHeatingActive) {
        if (data.centralHeatingActive) {
          await this.boilerStartedTrigger.trigger(this);
        } else {
          await this.boilerStoppedTrigger.trigger(this);
        }
      }
      this.prevBoilerHeating = data.centralHeatingActive;
    }
  }

};
