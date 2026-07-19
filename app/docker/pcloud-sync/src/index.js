import { normalizeConfig } from './config/config.js';
import { SqliteStore } from './store/sqliteStore.js';
import { SyncEngine } from './sync/engine.js';
import { ResticService } from './restic/service.js';
import { ResticPCloudBackend } from './restic/backend.js';
import { ResticIndexCatalog } from './restic/indexCatalog.js';
import { createApp, listen } from './web/server.js';

const dataDir = process.env.DATA_DIR || '/data';
const portOverride = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : null;

const store = new SqliteStore(dataDir);
await store.init();

let config = normalizeConfig(await store.loadConfig() ?? {});
if (portOverride) {
  config = normalizeConfig({ ...config, port: portOverride });
}
await store.saveConfig(config);

const engine = new SyncEngine({ store });
await engine.start();
const resticBackend = new ResticPCloudBackend({ store, dataDir });
await resticBackend.start();
const resticIndexCatalog = new ResticIndexCatalog({ store, dataDir });
const restic = new ResticService({ store, dataDir, backend: resticBackend, indexCatalog: resticIndexCatalog });
await restic.start();

const app = createApp({ store, engine, restic });
const server = listen(app, config.port);

console.log(`pCloud NAS Sync listening on ${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    engine.stop();
    restic.stop();
    await resticBackend.stop();
    server.close(() => process.exit(0));
  });
}
