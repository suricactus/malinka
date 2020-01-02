const WebSocket = require('ws');
const fs = require('fs');

const csv = require('fast-csv');
const Koa = require('koa');
const static = require('koa-static');
const websocket = require('koa-easy-ws');
const Gpio = require('onoff').Gpio;
const logger = require('pino')({ level: 'debug' });

const TemperatureReader = require('./TemperatureReader');

const CONFIG_FILE = './config.json';
const CSV_FILENAME = './records.csv';
const CSV_HEADERS = ['timestamp', 'inner_t', 'outer_t', 'water_t', 'expected_t', 'is_boiler_on'];
const SERVER_PORT = 7300;

const app = new Koa();
const websocketMiddleware = websocket();
const websocketServer = websocketMiddleware.server;

logger.trace('Setup server...');

app.use(websocketMiddleware);
app.use(async (ctx, next) => {
  if (!ctx.ws) return next();
  
  const ws = await ctx.ws();
  
  console.log(websocketServer)

  return ws.send(JSON.stringify({
    
  }));
});
app.use(static('./public'));

app.listen(SERVER_PORT);
logger.trace(`Server listening at port ${SERVER_PORT}`);


const fileExists = (filename) => fs.promises.access(filename, fs.constants.F_OK)
  .then(() => true)
  .catch(() => false);

const loadConfig = async () => {
  if (await fileExists(CONFIG_FILE)) {
    return JSON.parse(await fs.promises.readFile(CONFIG_FILE));
  }

  const defaults = {
    referenceInnerT: 20,
    toleranceDownT: 3,
    outerTSensorId: '28-01144cd685aa',
    innerTSensorId: '28-0303979405f1',
    waterSensorId: '28-030c979423c2',
    readIntervalS: 1,
    lastRecordsToGetMeanInner: 60,
    lastRecordsToGetMeanOuter: 60,
    lastRecordsToGetMeanWater: 1,
    calcExpectedTemperatureFormula: '-0.5 * outerT + 37 + (config.referenceInnerT - innerT) * 1.5',
    minimumAllowedWaterT: 0,
    maximumAllowedWaterT: 70,
    criticalAlarmWaterT: 80,
    controlBurnerOnOffPin: 17,
  };

  await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(defaults));

  return defaults;
}

const setGpioSensor = async (sensor, value) => {
  logger.trace('Sensor value changed', sensor, value);

  if (!sensor) return;
  
  value = value ? 1 : 0;

  return sensor.write(value);
};


const start = async () => {
  const config = await loadConfig();
  const outControlBurner = Gpio.accessible ? new Gpio(config.controlBurnerOnOffPin, 'out') : null;

  // make sure the pin is turned off
  await setGpioSensor(outControlBurner, false);

  fs.watch(CONFIG_FILE, async (eventType, filename) => {
    logger.info(`Config file changed: event "${eventType}" of file "${filename}"`)
    Object.assign(config, await loadConfig());
  });
  
  if (!await fileExists(CSV_FILENAME)) {
    const csvFile = fs.createWriteStream(CSV_FILENAME, { flags: 'w' });
    const csvStream = csv.format({ includeEndRowDelimiter: true });

    csvStream.pipe(csvFile);
    csvStream.write(CSV_HEADERS);
    csvStream.end();
  }

  const temperatureReader = new TemperatureReader({ config });
  
  temperatureReader.startReading();

  temperatureReader.on('error', ({ error }) => {
    logger.error(error);
  });

  temperatureReader.on('data', async (data) => {
    logger.debug({ data }, `New data received`);

    await setGpioSensor(outControlBurner, data.shouldStartBoiling);
  });

  temperatureReader.on('data', (data) => {
    websocketServer.clients.forEach(client => {
      client.send(JSON.stringify(data));
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
      inner_t: data.innerT,
      outer_t: data.outerT,
      water_t: data.waterT,
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

