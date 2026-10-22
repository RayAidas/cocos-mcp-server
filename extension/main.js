'use strict';

/**
 * cc-mcp extension main process.
 *
 * Hosts a local HTTP JSON-RPC endpoint (default http://127.0.0.1:32123) that
 * lets an external AI agent drive Cocos Creator:
 *   - scene / node / component manipulation (via the editor `scene` messages)
 *   - arbitrary engine code (via the `scene.js` scene script)
 *   - arbitrary editor code (in this Node.js main process)
 *   - asset database operations (via the `asset-db` messages)
 *   - headless command-line builds
 *   - preview / project introspection
 *
 * The cocos-mcp server (../mcp-server) is the normal client; it talks MCP over
 * stdio to the AI and forwards tool calls here over HTTP JSON-RPC.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const shared = require('./shared.js');

const DEFAULT_PORT = 32123;
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MB (asset content can be large)

let server = null;
let boundPort = DEFAULT_PORT;

function sceneRequest(message, ...args) {
  return Editor.Message.request('scene', message, ...args);
}
function assetRequest(message, ...args) {
  return Editor.Message.request('asset-db', message, ...args);
}

// ---------------------------------------------------------------------------
// Command handlers (method name -> async fn(params) -> result)
// ---------------------------------------------------------------------------

const handlers = {
  // -- meta ---------------------------------------------------------------
  'ping': async () => ({ pong: true, time: Date.now() }),
  'project.info': async () => ({
    name: Editor.Project.name,
    path: Editor.Project.path,
    uuid: Editor.Project.uuid,
    tmpDir: Editor.Project.tmpDir,
    editorVersion: Editor.App.version,
    appPath: Editor.App.path,
    appHome: Editor.App.home,
    platform: process.platform,
    arch: process.arch,
    rpcPort: boundPort,
  }),

  // -- arbitrary code execution ------------------------------------------
  'editor.eval': async (params) => {
    const code = params && params.code;
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error('editor.eval requires a non-empty `code` string');
    }
    const fn = new Function('Editor', 'require', 'process', 'module', 'console', '__dirname', code);
    const result = fn(Editor, require, process, module, console, __dirname);
    return shared.serialize(await result);
  },
  'scene.eval': async (params) => {
    const code = params && params.code;
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error('scene.eval requires a non-empty `code` string');
    }
    return sceneRequest('execute-scene-script', {
      name: 'cc-mcp',
      method: 'eval',
      args: [code],
    });
  },

  // -- scene: nodes -------------------------------------------------------
  'scene.queryNode': async (p) => sceneRequest('query-node', p.uuid),
  'scene.queryNodeTree': async (p) => sceneRequest('query-node-tree', p.uuid || null),
  'scene.createNode': async (p) => sceneRequest('create-node', {
    parent: p.parent || null,
    name: p.name,
    components: p.components,
    assetUuid: p.assetUuid,
    canvasRequired: p.canvasRequired,
    keepWorldTransform: p.keepWorldTransform,
    type: p.type,
    dump: p.dump,
  }),
  'scene.removeNode': async (p) => sceneRequest('remove-node', { uuid: p.uuid }),
  'scene.setParent': async (p) => sceneRequest('set-parent', {
    parent: p.parent,
    uuids: p.uuids,
    keepWorldTransform: p.keepWorldTransform,
  }),
  'scene.duplicateNode': async (p) => sceneRequest('duplicate-node', p.uuids),
  'scene.copyNode': async (p) => sceneRequest('copy-node', p.uuids),
  'scene.cutNode': async (p) => sceneRequest('cut-node', p.uuids),
  'scene.pasteNode': async (p) => sceneRequest('paste-node', { target: p.target, uuids: p.uuids, keepWorldTransform: p.keepWorldTransform }),

  // -- scene: properties --------------------------------------------------
  'scene.setProperty': async (p) => sceneRequest('set-property', { uuid: p.uuid, path: p.path, dump: p.dump }),
  'scene.resetProperty': async (p) => sceneRequest('reset-property', { uuid: p.uuid, path: p.path }),

  // -- scene: components --------------------------------------------------
  'scene.addComponent': async (p) => sceneRequest('create-component', { uuid: p.uuid, component: p.component }),
  'scene.removeComponent': async (p) => sceneRequest('remove-component', { uuid: p.uuid }),
  'scene.executeComponentMethod': async (p) => sceneRequest('execute-component-method', { uuid: p.uuid, name: p.name, args: p.args || [] }),
  'scene.queryComponents': async () => sceneRequest('query-components'),
  'scene.queryClasses': async () => sceneRequest('query-classes'),
  'scene.queryComponentHasScript': async (p) => sceneRequest('query-component-has-script', p.className),

  // -- scene: lifecycle ---------------------------------------------------
  'scene.save': async () => sceneRequest('save-scene'),
  'scene.open': async (p) => sceneRequest('open-scene', p.uuid),
  'scene.close': async () => sceneRequest('close-scene'),
  'scene.queryDirty': async () => sceneRequest('query-dirty'),
  'scene.queryIsReady': async () => sceneRequest('query-is-ready'),
  'scene.snapshot': async () => sceneRequest('snapshot'),
  'scene.softReload': async () => sceneRequest('soft-reload'),

  // -- scene script helpers ----------------------------------------------
  'scene.getSceneTree': async () => sceneRequest('execute-scene-script', { name: 'cc-mcp', method: 'getSceneTree', args: [] }),
  'scene.findNode': async (p) => sceneRequest('execute-scene-script', { name: 'cc-mcp', method: 'findNode', args: [p.pathOrUuid] }),
  'scene.listComponents': async (p) => sceneRequest('execute-scene-script', { name: 'cc-mcp', method: 'listComponents', args: [p.pathOrUuid] }),
  'scene.createPrefab': async (p) => {
    if (!p.uuid) throw new Error('scene.createPrefab requires a node `uuid`');
    if (!p.url) throw new Error('scene.createPrefab requires a target `url` (e.g. db://assets/Prefabs/Foo.prefab)');
    return sceneRequest('create-prefab', p.uuid, p.url);
  },

  // -- assets -------------------------------------------------------------
  'asset.queryInfo': async (p) => assetRequest('query-asset-info', p.urlOrUuid),
  'asset.queryMeta': async (p) => assetRequest('query-asset-meta', p.urlOrUuid),
  'asset.queryAssets': async (p) => assetRequest('query-assets', p.pattern),
  'asset.queryPath': async (p) => assetRequest('query-path', p.urlOrUuid),
  'asset.queryUrl': async (p) => assetRequest('query-url', p.uuid),
  'asset.queryUuid': async (p) => assetRequest('query-uuid', p.url),
  'asset.queryUsers': async (p) => assetRequest('query-asset-users', p.urlOrUuid, p.type),
  'asset.queryDependencies': async (p) => assetRequest('query-asset-dependencies', p.urlOrUuid, p.type),
  'asset.create': async (p) => assetRequest('create-asset', p.url, p.content != null ? p.content : null, p.option),
  'asset.import': async (p) => assetRequest('import-asset', p.source, p.target, p.option),
  'asset.copy': async (p) => assetRequest('copy-asset', p.source, p.target, p.option),
  'asset.move': async (p) => assetRequest('move-asset', p.source, p.target, p.option),
  'asset.rename': async (p) => assetRequest('move-asset', p.source, p.target, p.option),
  'asset.delete': async (p) => assetRequest('delete-asset', p.url),
  'asset.save': async (p) => assetRequest('save-asset', p.urlOrUuid, p.content),
  'asset.saveMeta': async (p) => assetRequest('save-asset-meta', p.urlOrUuid, p.content),
  'asset.reimport': async (p) => assetRequest('reimport-asset', p.urlOrUuid),
  'asset.refresh': async (p) => assetRequest('refresh-asset', p.urlOrUuid),
  'asset.open': async (p) => assetRequest('open-asset', p.urlOrUuid),

  // -- asset file helpers (project-relative paths) ------------------------
  'asset.readFile': async (p) => {
    const abs = resolveProjectPath(p.path);
    return fs.readFileSync(abs, 'utf8');
  },
  'asset.writeFile': async (p) => {
    const abs = resolveProjectPath(p.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.content != null ? p.content : '', 'utf8');
    const url = 'db://' + p.path.replace(/\\/g, '/').replace(/^\//, '');
    const imported = await assetRequest('import-asset', abs, url, { overwrite: true });
    return imported;
  },
  'asset.exists': async (p) => fs.existsSync(resolveProjectPath(p.path)),

  // -- asset bundles ------------------------------------------------------
  'asset.setBundle': async (p) => {
    const urlOrUuid = p.urlOrUuid;
    if (!urlOrUuid) throw new Error('asset.setBundle requires `urlOrUuid` (folder url or uuid)');
    const absPath = await assetRequest('query-path', urlOrUuid);
    if (!absPath) throw new Error('asset not found: ' + urlOrUuid);
    if (!fs.statSync(absPath).isDirectory()) {
      throw new Error('asset is not a folder: ' + urlOrUuid + ' (' + absPath + ')');
    }
    const metaPath = absPath + '.meta';
    if (!fs.existsSync(metaPath)) throw new Error('folder .meta not found: ' + metaPath);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.userData = meta.userData || {};
    if (p.isBundle === false) {
      // Unmark the folder as a bundle; drop bundle-specific keys so it matches a plain folder.
      delete meta.userData.isBundle;
      delete meta.userData.bundleName;
      delete meta.userData.bundleConfigID;
      delete meta.userData.priority;
    } else {
      meta.userData.isBundle = true;
      if (typeof p.bundleName === 'string' && p.bundleName) meta.userData.bundleName = p.bundleName;
      if (typeof p.priority === 'number') meta.userData.priority = p.priority;
    }
    const content = JSON.stringify(meta, null, 2);
    await assetRequest('save-asset-meta', urlOrUuid, content);
    return { urlOrUuid: urlOrUuid, metaPath: metaPath, userData: meta.userData };
  },
  'asset.queryBundle': async (p) => {
    const urlOrUuid = p.urlOrUuid;
    if (!urlOrUuid) throw new Error('asset.queryBundle requires `urlOrUuid` (folder url or uuid)');
    const absPath = await assetRequest('query-path', urlOrUuid);
    if (!absPath) throw new Error('asset not found: ' + urlOrUuid);
    const metaPath = absPath + '.meta';
    if (!fs.existsSync(metaPath)) {
      return { urlOrUuid: urlOrUuid, isBundle: false, bundleName: null, priority: null, userData: {} };
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const ud = meta.userData || {};
    return {
      urlOrUuid: urlOrUuid,
      metaPath: metaPath,
      isBundle: !!ud.isBundle,
      bundleName: typeof ud.bundleName === 'string' ? ud.bundleName : null,
      priority: typeof ud.priority === 'number' ? ud.priority : null,
      userData: ud,
    };
  },

  // -- build --------------------------------------------------------------
  'build.run': async (p) => runCliBuild(p || {}),
  'build.openPanel': async () => Editor.Message.request('builder', 'open'),

  // -- preview ------------------------------------------------------------
  'preview.open': async () => Editor.Message.request('preview', 'open-terminal'),
  'preview.reload': async () => Editor.Message.request('preview', 'reload-terminal'),
  'preview.queryUrl': async () => Editor.Message.request('preview', 'query-preview-url'),
  'preview.play': async () => { try { Editor.Message.send('preview', 'play'); return { ok: true }; } catch (e) { throw new Error('preview.play failed: ' + e.message); } },
  'preview.stop': async () => { try { Editor.Message.send('preview', 'stop'); return { ok: true }; } catch (e) { throw new Error('preview.stop failed: ' + e.message); } },

  // -- selection ----------------------------------------------------------
  'selection.select': async (p) => Editor.Selection.select(p.type, p.uuid),
  'selection.clear': async (p) => Editor.Selection.clear(p.type),
  'selection.getLastSelected': async (p) => Editor.Selection.getLastSelected(p.type),
};

function resolveProjectPath(p) {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error('path is required');
  }
  const cleaned = p.replace(/^db:\/\//, '').replace(/^\//, '');
  const abs = path.resolve(Editor.Project.path, cleaned);
  if (abs !== Editor.Project.path && !abs.startsWith(Editor.Project.path + path.sep)) {
    throw new Error('path escapes the project directory: ' + p);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Headless command-line build
// ---------------------------------------------------------------------------

function findEditorBinary() {
  const candidates = [];
  if (process.execPath && /CocosCreator/i.test(process.execPath)) {
    candidates.push(process.execPath);
  }
  // macOS: Editor.App.path is the "Contents/Resources" dir, so the executable
  // lives at ../MacOS/CocosCreator. Windows/Linux layouts are covered below.
  const app = Editor.App.path || '';
  candidates.push(path.join(app, '..', 'MacOS', 'CocosCreator'));
  candidates.push(path.join(app, 'Contents', 'MacOS', 'CocosCreator'));
  candidates.push(path.join(app, '..', 'CocosCreator.exe'));
  candidates.push(path.join(app, 'CocosCreator.exe'));
  candidates.push(path.join(app, '..', 'CocosCreator'));
  candidates.push(path.join(app, 'CocosCreator'));
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // Last resort: try the exec path anyway.
  return process.execPath || candidates[0];
}

function serializeBuildArgs(options) {
  if (typeof options.buildArgs === 'string' && options.buildArgs) {
    return options.buildArgs;
  }
  const pairs = [];
  const platform = options.platform || 'web-mobile';
  pairs.push('platform=' + platform);
  const passthrough = {
    debug: options.debug,
    md5Cache: options.md5Cache,
    buildPath: options.buildPath,
    startScene: options.startScene,
    scenes: options.scenes,
    name: options.name,
    inlineSpriteFrames: options.inlineSpriteFrames,
    sourceMaps: options.sourceMaps,
  };
  for (const key of Object.keys(passthrough)) {
    const v = passthrough[key];
    if (v !== undefined && v !== null) {
      if (typeof v === 'object') {
        pairs.push(key + '=' + JSON.stringify(v));
      } else {
        pairs.push(key + '=' + v);
      }
    }
  }
  return pairs.join(';');
}

function runCliBuild(options) {
  const binary = findEditorBinary();
  if (!binary || !fs.existsSync(binary)) {
    throw new Error('Cocos Creator binary not found. Tried process.execPath and Editor.App.path.');
  }
  const buildArg = serializeBuildArgs(options);
  const args = ['--project', Editor.Project.path, '--build', buildArg];
  if (options.force) args.push('--force');

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: Editor.Project.path,
      env: Object.assign({}, process.env, { CI: '1' }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timeout = options.timeoutMs || 0;
    const timer = timeout > 0 ? setTimeout(() => child.kill('SIGKILL'), timeout) : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        command: [binary].concat(args).join(' '),
        stdoutTail: stdout.slice(-8000),
        stderrTail: stderr.slice(-8000),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC HTTP server
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRpcCall(req) {
  const body = JSON.parse(req);
  if (Array.isArray(body)) {
    return Promise.all(body.map((item) => handleSingleRpc(item)));
  }
  return handleSingleRpc(body);
}

async function handleSingleRpc(reqObj) {
  const id = reqObj && reqObj.id;
  const method = reqObj && reqObj.method;
  const params = reqObj && reqObj.params;
  try {
    if (!method || typeof method !== 'string') {
      throw new Error('invalid request: missing `method`');
    }
    const handler = handlers[method];
    if (!handler) {
      throw new Error('unknown method: ' + method + '. Available: ' + Object.keys(handlers).sort().join(', '));
    }
    const result = await handler(params || {});
    return { jsonrpc: '2.0', id: id, result: result };
  } catch (e) {
    return {
      jsonrpc: '2.0',
      id: id,
      error: { code: -32603, message: (e && e.message) || String(e), data: (e && e.stack) ? e.stack.split('\n').slice(0, 5) : undefined },
    };
  }
}

async function handleRequest(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (urlPath === '/health' || urlPath === '/')) {
      sendJson(res, 200, {
        status: 'ok',
        service: 'cc-mcp',
        version: '1.0.0',
        project: Editor.Project.name,
        projectPath: Editor.Project.path,
        rpcPort: boundPort,
        methods: Object.keys(handlers).sort(),
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/rpc') {
      const raw = await readBody(req);
      const result = await handleRpcCall(raw);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && urlPath === '/rpc') {
      sendJson(res, 200, {
        hint: 'cc-mcp JSON-RPC endpoint (POST only).',
        usage: "curl -X POST http://127.0.0.1:32123/rpc -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}'",
        health: 'http://127.0.0.1:32123/health',
      });
      return;
    }

    sendJson(res, 404, { error: 'not found', hint: 'POST /rpc or GET /health' });
  } catch (e) {
    sendJson(res, 400, { error: (e && e.message) || String(e) });
  }
}

function readProjectMcpConfig() {
  if (!Editor || !Editor.Project || !Editor.Project.path) return {};
  const configPath = path.join(Editor.Project.path, '.cc-mcp.json');
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) {
    console.warn('[cc-mcp] invalid .cc-mcp.json:', e.message);
  }
  return {};
}

/** Port: CC_MCP_PORT env > .cc-mcp.json `port` > default. strictPort stops auto +1 on conflict. */
function resolveListenOptions() {
  const fileCfg = readProjectMcpConfig();
  const envPort = process.env.CC_MCP_PORT;
  const hasExplicitPort =
    (envPort != null && envPort !== '') || fileCfg.port != null;

  let startPort = DEFAULT_PORT;
  if (envPort != null && envPort !== '') {
    startPort = parseInt(envPort, 10);
  } else if (fileCfg.port != null) {
    startPort = parseInt(String(fileCfg.port), 10);
  }
  if (isNaN(startPort)) startPort = DEFAULT_PORT;

  let strictPort = fileCfg.strictPort;
  if (strictPort === undefined) strictPort = hasExplicitPort;

  const maxAttempts = strictPort ? 1 : 20;
  return { startPort, maxAttempts, strictPort };
}

function startServer() {
  const { startPort, maxAttempts, strictPort } = resolveListenOptions();
  return new Promise((resolve, reject) => {
    const tryPort = (port, attemptsLeft) => {
      const s = http.createServer(handleRequest);
      s.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryPort(port + 1, attemptsLeft - 1);
        } else if (err.code === 'EADDRINUSE' && strictPort) {
          reject(
            new Error(
              'port ' + port + ' is already in use (strictPort). Change `port` in .cc-mcp.json or set CC_MCP_PORT.'
            )
          );
        } else {
          reject(err);
        }
      });
      s.listen(port, '127.0.0.1', () => {
        boundPort = port;
        server = s;
        resolve(port);
      });
    };
    tryPort(startPort, maxAttempts);
  });
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

exports.load = async function load() {
  try {
    const port = await startServer();
    console.log('[cc-mcp] listening on http://127.0.0.1:' + port + '/rpc');
  } catch (e) {
    console.error('[cc-mcp] failed to start HTTP server:', e);
  }
};

exports.unload = async function unload() {
  if (server) {
    server.close();
    server = null;
  }
};

exports.methods = {
  handlers,
  get port() { return boundPort; },
};
