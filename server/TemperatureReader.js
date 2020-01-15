const EventEmitter = require('events');
const path = require('path');
const math = require('mathjs');

const logger = require('./logger');
const { average } = require('./utils');
const { getSensorTemperature, getSensorValue } = require('./hw');
const { PURPOSE_INNER, PURPOSE_OUTER, PURPOSE_WATER, PURPOSE_NONE } = require('./constants');

class TemperatureReader extends EventEmitter {
  isBoilerOn = false;
  config = null;
  _intervalId = null;
  records = {};

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

    clearInterval(this._intervalId);

    const readIntervalS = this.config.readIntervalS;
    const cb = async () => {
      if (readIntervalS !== this.config.readIntervalS) {
        clearInterval(this._intervalId);

        this._intervalId = setInterval(cb, this.config.readIntervalS * 1000);
      }

      await this.calcShouldStartBoiling();
    };

    this._intervalId = setInterval(cb, readIntervalS * 1000);
  }

  _sensorValuesToTokens({ sensorValues }) {
    const sensorsByPurpose = { [PURPOSE_INNER]: [], [PURPOSE_OUTER]: [], [PURPOSE_WATER]: [] };
    const purposes = [PURPOSE_INNER, PURPOSE_OUTER, PURPOSE_WATER, PURPOSE_NONE];
    const limitByPurpose = {
      [PURPOSE_INNER]: this.config.lastRecordsToGetMeanInner,
      [PURPOSE_OUTER]: this.config.lastRecordsToGetMeanOuter,
      [PURPOSE_WATER]: this.config.lastRecordsToGetMeanWater,
    };

    for (const { uid, value } of sensorValues) {
      const { purpose } = this.config.sensors[uid];
      
      if (!purposes.includes(purpose)) {
        throw new Error(`Unknowm sensor purpose: ${purpose}`);
      }
      
      if (purpose === PURPOSE_NONE) continue;

      this.records[uid] = this.records[uid] || [];
      this.records[uid].push(value);
      
      if (this.records[uid].length > limitByPurpose[purpose]) {
        this.records[uid].shift();
      }
      
      sensorsByPurpose[purpose].push(average(this.records[uid]));
    }
    
    const tokens = {};
    
    for (const [purpose, values] of Object.entries(sensorsByPurpose)) {
      const purposeLower = purpose.toLowerCase();
      
      for (const [idx, value] of values.entries()) {
        tokens[`${purposeLower}${idx + 1}`] = value;
      }
      
      tokens[`${purposeLower}Avg`] = average(values);
    }
    
    return tokens;
  }

  async calcShouldStartBoiling() {
    try {
      const settings = this.config;
      const uids = Object.entries(settings.sensors)
        .filter(([uid, purpose]) => purpose !== PURPOSE_NONE)
        .map(([uid]) => uid);

      const sensorValues = await Promise.all(uids.map(uid => getSensorValue(uid, true)));
      const tokens = this._sensorValuesToTokens({ sensorValues });
      const expectedT = this._calcExpectedTemperature({ tokens });
      const shouldStartBoiling = this._calcShouldStartBoiling({ tokens, expectedT });

      this.isBoilerOn = shouldStartBoiling;
  
      this.emit('data', {
        timestamp: new Date().toISOString(),
        tokens,
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

  _calcExpectedTemperature({ tokens }) {
    const scope = {
      ...tokens,
      config: this.config,
    };

    return math.evaluate(this.config.calcExpectedTemperatureFormula, scope);
  }

  _calcShouldStartBoiling({ tokens, expectedT }) {
    const { outerAvg, waterAvg } = tokens;

    if (outerAvg > this.config.minOuterToStartBoilingT) return false;
    if (expectedT > this.config.maximumAllowedWaterT) return false;
    if (waterAvg > this.config.maximumAllowedWaterT) return false;
    if (expectedT < this.config.minimumAllowedWaterT) return true;
    if (waterAvg < this.config.minimumAllowedWaterT) return true;
    
    if (waterAvg < expectedT) {
      if (this.isBoilerOn) return true;
      
      if (expectedT - waterAvg > this.config.toleranceDownT) {
        return true;
      }

      return false;
    }

    return false;
  }
}

module.exports = TemperatureReader;