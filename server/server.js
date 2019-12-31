const WebSocket = require('ws');
const fs = require('fs');

const csv = require('fast-csv');

const TemperatureReader = require('./TemperatureReader');

const CONFIG_FILE = './config.json';

// const wss = new WebSocket.Server({ port: 8080 });

// wss.on('connection', (ws) => {
//   ws.on('message', (data) => {
//     wss.clients.forEach((client) => {
//       if (client.readyState === WebSocket.OPEN) {
//         client.send(data);
//       }
//     });
//   });
// });

const fileExists = (filename) => fs.promises.access(filename, fs.constants.F_OK)
  .then(() => true)
  .catch(() => false);

const loadConfig = async () => {
  if (await fileExists(CONFIG_FILE)) {
    return JSON.parse(await fs.promises.readFile(CONFIG_FILE));
  }

  const defaults = {
    referenceInnerT: 21,
    toleranceDownT: 3,
    outerTSensorId: 'example.output',
    innerTSensorId: 'example.output',
    waterSensorId: 'example.output',
    readIntervalS: 2,
  };

  await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(defaults));

  return defaults;
}


const start = async () => {
  const config = await loadConfig();

  fs.watch(CONFIG_FILE, async (eventType, filename) => {
    console.log(`Config file changed: event "${eventType}" of file "${filename}"`)
    Object.assign(config, await loadConfig());
  });
  
  const temperatureReader = new TemperatureReader({ config });
  
  temperatureReader.startReading();
  temperatureReader.on('error', ({ error }) => {
    console.log('OOPSIE!!!', error);
  });
  
  temperatureReader.on('data', (data) => {
    const csvStream = csv.format({ includeEndRowDelimiter: true });
    const csvFile = fs.createWriteStream('../records.csv', { flags: 'a' });
    
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

    console.log(`New data received: ${JSON.stringify(data)}`)
  });
};

start()
  .catch((error) => {
    console.log(error)
    
  });

