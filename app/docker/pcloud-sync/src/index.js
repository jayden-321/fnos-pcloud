import { normalizeConfig } from './config/config.js';
import { JsonStore } from './store/jsonStore.js';
import { SyncEngine } from './sync/engine.js';
import { createApp, listen } from './web/server.js';

const dataDir = process.env.DATA_DIR || '/data';
const portOverride = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : null;

const store = new JsonStore(dataDir);
await store.init();

let config = normalizeConfig(await store.loadConfig() ?? {});
if (portOverride) {
  config = normalizeConfig({ ...config, port: portOverride });
}
await store.saveConfig(config);

const engine = new SyncEngine({ store });
await engine.start();

const app = createApp({ store, engine });
const server = listen(app, config.port);

console.log(`pCloud NAS Sync listening on ${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    engine.stop();
    server.close(() => process.exit(0));
  });
}
