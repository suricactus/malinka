const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const { loadSettings, resetSettings, patchSettings } = require('./utils');
const { getAllSensors } = require('./hw');

const app = new Koa();
const router = new Router();

let id = 1;

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
