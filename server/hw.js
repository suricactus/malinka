const assert = require('assert');
const fs = require('fs').promises;

const getSensorTemperature = async (filename) => {
  const contents = await fs.readFile(filename).then(b => b.toString());
  const [ line1, line2 ] = contents.split('\n');
  const end = line1.substr(-3);

  if (end !== 'YES') return await getSensorTemperature(filename);
  const matches = line2.match(/ t=(\d+)$/);

  assert(matches, 'Expected the sensor output to be readable');

  const temperature = matches[1] / 1000;

  assert(Number.isFinite(+temperature), `Expected sensor value to be a finite number, but ${temperature} found`);

  return temperature;
};

module.exports = {
  getSensorTemperature,
};
