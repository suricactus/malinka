const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const { loadSettings, roundTo } = require('./utils');
const {
  PURPOSE_NONE,
} = require('./constants');

const DEVICES_DIR = '/sys/bus/w1/devices/';

const getSensorTemperature = async (sensorUid, shouldApplyOffset = false) => {
  const settings = await loadSettings();
  const filename = path.join(DEVICES_DIR, sensorUid, 'w1_slave');
  const contents = await fs.readFile(filename).then(b => b.toString());
  const [ line1, line2 ] = contents.split('\n');
  const end = line1.substr(-3);

  if (end !== 'YES') return await getSensorTemperature(filename, shouldApplyOffset);

  const matches = line2.match(/ t=(-?\d+)$/);

  assert(matches, 'Expected the sensor output to be readable');
  
  const offsetT = shouldApplyOffset && 
    settings.sensors[sensorUid].offsetT 
    ? +settings.sensors[sensorUid].offsetT 
    : 0;
  const temperature = matches[1] / 1000 + offsetT;

  assert(Number.isFinite(+temperature), `Expected sensor value to be a finite number, but ${temperature} found`);

  return temperature;
};

const getAllSensorsUids = async () => {
  const dirs = await fs.readdir(DEVICES_DIR);

  return dirs.filter(dir => dir.startsWith('28-')).sort();
};

const getAllSensors = async () => {
  const settings = await loadSettings();
  const sensors = await getAllSensorsUids();
  const promises = sensors.map(s => getSensorTemperature(s));
  const temperatures = await Promise.allSettled(promises);
  const data = sensors
    .reduce((d, uid, i) => {
      const result = temperatures[i];
      const value = (result.status === 'fulfilled')
        ? result.value
        : null;
      const error = result.status === 'rejected'
        ? result.reason.message
        : undefined;

      return {
        ...d,
        [uid]: {
          uid,
          value,
          error,
        },
      };
    }, {});
  
  for (const uid of Object.keys(data)) {
    const uidSettings = settings.sensors[uid] || {};
    
    data[uid] = {
      ...data[uid],
      purpose: uidSettings.purpose || PURPOSE_NONE,
      offsetT: uidSettings.offsetT || 0,
    };
  }

  return data;
};

const getSensorValue = async (uid, shouldApplyOffset) => {
  return { uid, value: await getSensorTemperature(uid, shouldApplyOffset) };
};

const setGpioSensorValue = async (sensor, value) => {
  logger.trace('Sensor value changed', sensor, value);

  if (!sensor) return;

  value = value ? 1 : 0;

  return sensor.write(value);
};


module.exports = {
  getSensorTemperature,
  getSensorValue,
  getAllSensorsUids,
  getAllSensors,
  setGpioSensorValue,
};
