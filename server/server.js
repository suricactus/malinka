const WebSocket = require('ws');
const fs = require('fs');

const Koa = require('koa');
const static = require('koa-static');
const websocket = require('koa-easy-ws');
const mount = require('koa-mount');
const Gpio = require('onoff').Gpio;
const sqlite = require('sqlite');

const { CONFIG_FILENAME, SQLITE_FILENAME } = require('./constants');
const TemperatureReader = require('./TemperatureReader');
const logger = require('./logger');
const { fileExists, loadSettings } = require('./utils');
const { getAllSensorsTemperature } = require('./hw');
const api = require('./api');

const SERVER_PORT = 7300;

const app = new Koa();
const websocketMiddleware = websocket();
const wss = websocketMiddleware.server;

logger.info('Setup server...');

const methods = {
  getAllSensorsTemperature,

};

app.use(websocketMiddleware);
app.use(async (ctx, next) => {
  if (!ctx.ws) return next();
  
  const ws = await ctx.ws();

  // this is a websocket request
});
app.use(mount('/api', api));

app.use(static('./public'));

app.listen(SERVER_PORT);

logger.info(`Server listening at port ${SERVER_PORT}`);

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
  // prepare the db
  const db = await sqlite.open(SQLITE_FILENAME, { cached: true });
  try {
    await db.exec(`
    
    CREATE TABLE records (
      timestamp timestamp not null,
      is_boiler_on boolean not null,
      has_err_r_sensor boolean not null,
      inner_avg float not null,
      outer_avg float not null,
      water_avg float not null,
      expected_t float not null
      )
      
    `);
    logger.info('Created the table');
  } catch (error) {
    if (error.toString().indexOf('already exists') >= 0) {
      logger.trace('Table already exists');
    } else {
      throw error;
    } 
  }
  const stmtInsert = await db.prepare(`
  
    INSERT INTO records (timestamp, inner_avg, outer_avg, water_avg, expected_t, is_boiler_on, has_err_r_sensor)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  
  `);

  // make sure the pin is turned off
  await setGpioSensor(outControlBurner, false);

  fs.watch(CONFIG_FILENAME, async (eventType, filename) => {
    logger.info(`Config file changed: event "${eventType}" of file "${filename}"`)
    Object.assign(settings, await loadSettings());
  });
  
  const temperatureReader = new TemperatureReader({ config: settings });
  
  temperatureReader.startReading();

  temperatureReader.on('error', ({ error }) => {
    logger.error(error);
  });

  // set sensor
  temperatureReader.on('data', async (data) => {
    logger.debug({ data }, `New data received`);

    await setGpioSensor(outControlBurner, data.shouldStartBoiling);
  });

  // WebSocket send new measurement
  temperatureReader.on('data', (data) => {
    wss.clients.forEach(client => {
      client.send(JSON.stringify(jsonrpcNotify('new_measurement', data)));
    });
  });

  // SQLite write every 5 seconds
  let lastRecord = null;

  temperatureReader.on('data', async (data) => {
    if (new Date() - lastRecord < 5 * 1000) return;
    
    lastRecord = new Date();

    try {
      await stmtInsert.run([
        data.timestamp,
        data.tokens.innerAvg,
        data.tokens.outerAvg,
        data.tokens.waterAvg,
        data.expectedT,
        data.shouldStartBoiling,
        data.hasErrorReadingSensor,
      ]);
    } catch (error) {
      logger.error(error);
    }
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
  process.on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
  });
};

start()
  .catch((error) => {
    logger.fatal(error)
    
  });

