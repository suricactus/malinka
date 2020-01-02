const EventEmitter = require('events');
const path = require('path');
const math = require('mathjs');
const { getSensorTemperature } = require('./hw');

// const DEVICES_DIR = '/sys/bus/w1/devices/';
const DEVICES_DIR = '../';

class TemperatureReader extends EventEmitter {
  isBoilerOn = false;
  config = null;
  _intervalId = null;

  constructor({ config }) {
    super();

    this.config = config;
  }

  setConfig(config) {
    this.config = config;

    return config;
  }

  async startReading() {
    await this.calcShouldStartBoiling();

    clearInterval = clearInterval(this._intervalId);

    this._intervalId = setInterval(async () => {
      await this.calcShouldStartBoiling();
    }, this.config.readIntervalS * 1000);
  }

  async calcShouldStartBoiling() {
    try {
      const config = this.config;
      const [innerT, outerT, waterT] = await Promise.all([
        getSensorTemperature(path.join(DEVICES_DIR, config.innerTSensorId)),
        getSensorTemperature(path.join(DEVICES_DIR, config.outerTSensorId)),
        getSensorTemperature(path.join(DEVICES_DIR, config.waterSensorId)),
      ]);
      const expectedT = this._calcExpectedTemperature({ innerT, outerT, waterT });
      const shouldStartBoiling = this._calcShouldStartBoiling({ innerT, outerT, waterT, expectedT });
      this.isBoilerOn = shouldStartBoiling;
  
      this.emit('data', {
        timestamp: new Date().toISOString(),
        innerT, 
        outerT,
        waterT,
        expectedT,
        shouldStartBoiling,
      });
    } catch (error) {
      this.emit('error', {
        timestamp: new Date().toISOString(),
        error,
      });
    }
  }

  _calcExpectedTemperature({ innerT, outerT, waterT }) {
    const scope = {
      innerT,
      outerT,
      waterT,
      config: this.config,
    };

    return math.evaluate(this.config.calcExpectedTemperatureFormula, scope);
    
    // return 0.5 * outerT + 37 + (this.config.referenceInnerT - innerT) * 1.5;
  }

  _calcShouldStartBoiling({ waterT, expectedT }) {
    if (expectedT < this.config.minimumAllowedWaterT) return false;
    if (expectedT > this.config.maximumAllowedWaterT) return false;

    if (waterT < expectedT) {
      if (this.isBoilerOn) return true;

      if (expectedT - waterT > this.config.toleranceDownT) {
        return true;
      }

      return false;
    }

    return false;
  }
}

module.exports = TemperatureReader;