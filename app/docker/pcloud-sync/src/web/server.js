import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, redactConfig } from '../config/config.js';
import { defaultLocalRoots, listLocalFolders } from '../folders/localFolders.js';
import { PCloudClient } from '../pcloud/client.js';
import { APP_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

export function createApp({ store, engine, pcloudFactory = null, localRoots = null }) {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
          return await handleApi({ request, url, store, engine, pcloudFactory, localRoots });
        }
        return await serveStatic(url.pathname);
      } catch (error) {
        return json({ error: error.message }, error.statusCode || 500);
      }
    }
  };
}

export function listen(app, port, host = '0.0.0.0') {
  const server = createServer(async (req, res) => {
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      duplex: ['GET', 'HEAD'].includes(req.method) ? undefined : 'half'
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
    }
    res.end();
  });
  server.listen(port, host);
  return server;
}

async function handleApi({ request, url, store, engine, pcloudFactory, localRoots }) {
  if (request.method === 'GET' && url.pathname === '/api/config') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    return json(redactConfig(config));
  }

  if (request.method === 'POST' && url.pathname === '/api/config') {
    const previous = normalizeConfig(await store.loadConfig() ?? {});
    const body = await request.json();
    const config = normalizeConfig(mergeConfig(previous, body));
    await store.saveConfig(config);
    return json(redactConfig(config));
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    return json({
      version: APP_VERSION,
      tasks: config.tasks,
      stats: await store.stats(),
      failed: await store.listFiles({ status: 'failed' }),
      pending: await store.listFiles({ status: 'pending' }),
      uploading: await store.listFiles({ status: 'uploading' }),
      events: await store.listEvents(200),
      engine: engine.getStatus?.() ?? {}
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/local-folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const roots = localRoots ?? defaultLocalRoots(config.tasks.map((task) => task.localPath));
    return json(await listLocalFolders(url.searchParams.get('path') || '', roots));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.listRemoteFolders(url.searchParams.get('path') || config.pcloud.remoteRoot));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/current-server') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.currentServer());
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/api-server') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.getApiServer());
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/upload-progress') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.uploadProgress(url.searchParams.get('progresshash') || ''));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/checksum') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.checksumFile({
      fileid: url.searchParams.get('fileid'),
      path: url.searchParams.get('path') || ''
    }));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/diff') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.diff(Object.fromEntries(url.searchParams.entries())));
  }

  if (request.method === 'POST' && url.pathname === '/api/pcloud/folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const body = await request.json();
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.ensureFolder(body.path));
  }

  if (request.method === 'POST' && url.pathname === '/api/scan') {
    return json(await engine.scanNow());
  }

  if (request.method === 'POST' && url.pathname === '/api/retry-failed') {
    const queued = await engine.retryFailed();
    const drained = queued > 0 && engine.processPending ? await engine.processPending() : { uploaded: 0, failed: 0 };
    return json({ queued, uploaded: drained.uploaded ?? 0, failed: drained.failed ?? 0 });
  }

  if (request.method === 'POST' && url.pathname === '/api/oauth/exchange') {
    const body = await request.json();
    const config = normalizeConfig(mergeConfig(await store.loadConfig() ?? {}, body));
    const client = new PCloudClient({
      hostname: config.pcloud.hostname,
      accessToken: config.pcloud.accessToken
    });
    const token = await client.exchangeCode({
      clientId: config.pcloud.clientId,
      clientSecret: config.pcloud.clientSecret,
      code: body.code
    });
    config.pcloud.accessToken = token.accessToken;
    if (token.hostname) {
      config.pcloud.hostname = token.hostname;
    }
    await store.saveConfig(config);
    return json({ tokenType: token.tokenType, uid: token.uid, config: redactConfig(config) });
  }

  if (request.method === 'POST' && url.pathname === '/api/pcloud/test') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.userInfo());
  }

  return json({ error: 'Not found' }, 404);
}

async function serveStatic(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(await readFile(filePath), {
      headers: { 'content-type': contentType(filePath) }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Response('Not found', { status: 404 });
    }
    throw error;
  }
}

function mergeConfig(previous, patch) {
  const pcloudPatch = { ...(patch.pcloud ?? {}) };
  for (const key of ['clientSecret', 'accessToken']) {
    if (pcloudPatch[key] === '***' || pcloudPatch[key] === '') {
      delete pcloudPatch[key];
    }
  }
  return {
    ...previous,
    ...patch,
    pcloud: { ...(previous.pcloud ?? {}), ...pcloudPatch },
    sync: { ...(previous.sync ?? {}), ...(patch.sync ?? {}) },
    tasks: patch.tasks ?? previous.tasks ?? [],
    sources: patch.sources ?? previous.sources ?? []
  };
}

function json(body, status = 200) {
  return Response.json(body, { status });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
