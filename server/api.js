const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const sqlite = require('sqlite');
const csv = require('fast-csv');

const { SQLITE_FILENAME } = require('./constants');
const { loadSettings, resetSettings, patchSettings } = require('./utils');
const { getAllSensors } = require('./hw');

const app = new Koa();
const router = new Router();
const dbPromise = sqlite.open(SQLITE_FILENAME, { cached: true });

router.get('/settings', async (ctx) => {
  ctx.body = await loadSettings();
});

router.patch('/settings', async (ctx) => {
  const settings = await patchSettings(ctx.request.body);

  ctx.body = settings;
});

router.post('/settings/reset', async (ctx) => {
  await resetSettings();
  
  ctx.body = await loadSettings();
});

router.get('/sensors', async (ctx) => {
  ctx.body = await getAllSensors();
});

router.post('/sensors', async (ctx) => {
  const settings = await loadSettings();
  const sensors = ctx.request.body;
  const newSettings = { sensors: {} };
  
  for (const [uid, { purpose, offsetT }] of Object.entries(sensors)) {
    newSettings.sensors[uid] = newSettings.sensors[uid] || [];
    newSettings.sensors[uid] = {
      purpose: purpose.toUpperCase(),
      offsetT,
    };
  }

  await patchSettings(newSettings);

  ctx.body = newSettings;
});

router.get('/records', async (ctx) => {
  const db = await dbPromise;
  const now = new Date();
  const lastTenMinutes = new Date(now - 5 * 60 * 1000);
  const { start = lastTenMinutes, end = now, download = false } = ctx.query;
  
  if (!download) {
    // TODO make this a prepared statement and reuse it
    const rows = await db.all(`
    
      SELECT *
      FROM records
      WHERE timestamp >= ? AND timestamp < ?
    
    `, new Date(start).toISOString(), new Date(end).toISOString());

    ctx.body = rows;

    return;
  }

  const cols = ['timestamp', 'inner_avg', 'outer_avg', 'water_avg', 'expected_t', 'is_boiler_on', 'has_err_r_sensor'];
  const stream = csv.format();

  stream.write(cols);

  await db.each(`
  
    SELECT *
    FROM records
    WHERE timestamp >= ? AND timestamp < ?
  
  `, new Date(start).toISOString(), new Date(end).toISOString(), (err, row) => {
    try {
      if (err) throw err;

      const vals = [];
  
      for (const col of cols) {
        vals.push(row[col]);
      }
  
      stream.write(vals);
    } catch (error) {
      if (error === err) {
        logger.error(err, 'Error encountered');
      } else {
        logger.error(error, 'Error encountered');
      }
    }
  });

  stream.end();

  ctx.response.set('Content-Disposition', `attachment; filename = "records_${new Date().toISOString()}.csv"`)
  ctx.body = stream;
});

app
  .use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      ctx.status = err.status || 500;
      ctx.body = err.message;
      ctx.app.emit('error', err, ctx);
    }
  })
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(3000);
  
module.exports = app;
