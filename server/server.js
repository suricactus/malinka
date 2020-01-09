const WebSocket = require('ws');
const fs = require('fs');

const csv = require('fast-csv');
const Koa = require('koa');
const static = require('koa-static');
const websocket = require('koa-easy-ws');
const mount = require('koa-mount');
const Gpio = require('onoff').Gpio;

const { CONFIG_FILENAME } = require('./constants');
const TemperatureReader = require('./TemperatureReader');
const logger = require('./logger');
const { fileExists, loadSettings } = require('./utils');
const { getAllSensorsTemperature } = require('./hw');
const api = require('./api');

const CSV_FILENAME = './records.csv';
const CSV_HEADERS = ['timestamp', 'inner_t', 'outer_t', 'water_t', 'expected_t', 'is_boiler_on'];
const SERVER_PORT = 7300;

const app = new Koa();
const websocketMiddleware = websocket();
const wss = websocketMiddleware.server;

logger.trace('Setup server...');

const methods = {
  getAllSensorsTemperature,

};

logger.info('Current user is: ', require("os").userInfo().username);

app.use(websocketMiddleware);
app.use(async (ctx, next) => {
  if (!ctx.ws) return next();
  
  const ws = await ctx.ws();

  // this is a websocket request
});
app.use(mount('/api', api));

app.use(static('./public'));

app.listen(SERVER_PORT);

logger.trace(`Server listening at port ${SERVER_PORT}`);

const jsonrpcNotify = (channel, params) => ({
  id: null,
  jsonrpc: '2.0',
  method: channel,
  params,
});

const setGpioSensor = async (sensor, value) => {
  logger.trace('Sensor value changed', sensor, value);

  if (!sensor) return;
  
  value = value ? 1 : 0;

  return sensor.write(value);
};

const start = async () => {
  const settings = await loadSettings();
  const outControlBurner = Gpio.accessible ? new Gpio(settings.controlBurnerOnOffPin, 'out') : null;

  // make sure the pin is turned off
  await setGpioSensor(outControlBurner, false);

  fs.watch(CONFIG_FILENAME, async (eventType, filename) => {
    logger.info(`Config file changed: event "${eventType}" of file "${filename}"`)
    Object.assign(settings, await loadSettings());
  });
  
  if (!await fileExists(CSV_FILENAME)) {
    const csvFile = fs.createWriteStream(CSV_FILENAME, { flags: 'w' });
    const csvStream = csv.format({ includeEndRowDelimiter: true });

    csvStream.pipe(csvFile);
    csvStream.write(CSV_HEADERS);
    csvStream.end();
  }

  const temperatureReader = new TemperatureReader({ config: settings });
  
  temperatureReader.startReading();

  temperatureReader.on('error', ({ error }) => {
    logger.error(error);
  });

  temperatureReader.on('data', async (data) => {
    logger.debug({ data }, `New data received`);

    await setGpioSensor(outControlBurner, data.shouldStartBoiling);
  });

  temperatureReader.on('data', (data) => {
    wss.clients.forEach(client => {
      client.send(JSON.stringify(jsonrpcNotify('new_measurement', data)));
    });
  });

  temperatureReader.on('data', (data) => {
    const csvFile = fs.createWriteStream(CSV_FILENAME, { flags: 'a' });
    const csvStream = csv.format({ 
      includeEndRowDelimiter: true,
      writeHeaders: false,
     });
    
    csvStream.pipe(csvFile);
    csvStream.write({
      timestamp: data.timestamp,
      inner_t: data.tokens.innerAvg,
      outer_t: data.tokens.outerAvg,
      water_t: data.tokens.waterAvg,
      expected_t: data.expectedT,
      is_boiler_on: Number(data.shouldStartBoiling),
    });
    csvStream.end();
  });

  const signalHandler = async signal => {
    try {
      logger.warn(`Exiting process with signal ${signal}...`);

      if (!outControlBurner) return;

      await setGpioSensor(outControlBurner, false);
  
      outControlBurner.unexport();
    } catch (error) {
      // TODO audit
      logger.error(error, 'Error occurred while exiting the process!');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
};

start()
  .catch((error) => {
    logger.fatal(error)
    
  });

