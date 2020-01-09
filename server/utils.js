const fs = require('fs').promises;
const { F_OK } = require('fs').constants;
const { watch } = require('fs');

const { CONFIG_FILENAME } = require('./constants');
const logger = require('./logger');

const defaults = {
  referenceInnerT: 20,
  toleranceDownT: 3,
  readIntervalS: 2,
  lastRecordsToGetMeanInner: 60,
  lastRecordsToGetMeanOuter: 60,
  lastRecordsToGetMeanWater: 1,
  calcExpectedTemperatureFormula: '-0.5 * outerAvg + 37 + (config.referenceInnerT - innerAvg) * 1.5',
  minimumAllowedWaterT: 0,
  maximumAllowedWaterT: 70,
  criticalAlarmWaterT: 80,
  minOuterToStartBoilingT: 20,
  controlBurnerOnOffPin: 17,
  alarmBurnerInPin: 18,
  controlPumpOnOffPin: 19,
  roundDigits: 4,
  sensors: {
    "28-01144cd685aa": {
      purpose: "INNER",
      offsetT: 0
    },
    "28-0303979405f1": {
      purpose: "WATER",
      offsetT: 0
    },
    "28-030c979423c2": {
      purpose: "OUTER",
      offsetT: 0
    }
  },
};
const settings = Object.assign({}, defaults);

const fileExists = (filename) => fs.access(filename, F_OK)
  .then(() => true)
  .catch(() => false);

const loadSettings = async () => {
  if (await fileExists(CONFIG_FILENAME)) {
    const loadedSettings = JSON.parse(await fs.readFile(CONFIG_FILENAME));

    return Object.assign(settings, loadedSettings);
  }

  await saveSettings(defaults);

  return defaults;
};

const resetSettings = async () => {
  await fs.unlink(CONFIG_FILENAME);

  return loadSettings();
};

const saveSettings = async (newSettings) => {
  await fs.writeFile(CONFIG_FILENAME, JSON.stringify(newSettings, null, 2));

  return Object.assign(settings, newSettings)
};

const patchSettings = async (patch) => {
  const currentSettings = JSON.stringify(settings);
  const fsSettings = JSON.stringify(await loadSettings());

  if (currentSettings !== fsSettings) {
    throw new Error('Unable to save settings when there is mismatch between application and saved settings');
  }

  return saveSettings(Object.assign(settings, patch));
};

const roundTo = (value, digits) => {
  const powerOfTen = Math.pow(10, digits);

  return Math.round(value * powerOfTen) / powerOfTen;
};

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length;

module.exports = {
  fileExists,
  loadSettings,
  resetSettings,
  saveSettings,
  patchSettings,
  roundTo,
  average,
};
