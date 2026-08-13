'use strict';

/**
 * cocos-mcp: an MCP server that drives Cocos Creator.
 *
 * Transport: MCP over stdio (so Claude/Cursor/VS Code/etc. can spawn it).
 * Backend:   HTTP JSON-RPC to the cc-mcp editor extension
 *            (http://127.0.0.1:32123/rpc by default).
 *
 * Environment variables:
 *   CC_MCP_URL    base URL of the extension (default http://127.0.0.1:32123)
 *   CC_MCP_TOKEN  optional bearer token (must match the extension, if set)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CocosClient } from './client.js';

const client = new CocosClient();

function text(result) {
  const body =
    result === undefined
      ? 'ok'
      : typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text: body }] };
}

// Small schema helpers to keep definitions readable.
const optString = z.string().optional();
const strArray = z.array(z.string());

const tools = [
  // ------------------------------------------------------------------- meta
  { name: 'ping', title: 'Ping the editor', description: 'Check that the cc-mcp extension is reachable. Returns editor health/project info.', schema: {}, run: () => client.health() },
  { name: 'project_info', title: 'Project info', description: 'Return current project name, path, uuid, and the Cocos Creator version.', schema: {}, run: () => client.call('project.info') },

  // ------------------------------------------------------------------- scene
  {
    name: 'scene_get_tree',
    title: 'Get scene node tree',
    description: 'Dump the currently open scene root node as a nested tree (nodes, transforms, components, children).',
    schema: {},
    run: () => client.call('scene.getSceneTree'),
  },
  {
    name: 'scene_query_node',
    title: 'Query node',
    description: 'Return the editor dump (full serialized data) of a node by its uuid.',
    schema: { uuid: z.string().describe('node uuid') },
    run: (a) => client.call('scene.queryNode', { uuid: a.uuid }),
  },
  {
    name: 'scene_find_node',
    title: 'Find node by path or uuid',
    description: "Find a node by path (e.g. 'Canvas/Label') or by uuid, and return a concise serialized view.",
    schema: { pathOrUuid: z.string().describe("node path such as 'Canvas/Label', or node uuid") },
    run: (a) => client.call('scene.findNode', { pathOrUuid: a.pathOrUuid }),
  },
  {
    name: 'scene_create_node',
    title: 'Create node',
    description: 'Create a node (optionally as a child of `parent`) in the current scene. `components` is a list of component class names such as "cc.Sprite", "cc.Label", "cc.UITransform".',
    schema: {
      name: z.string().describe('node name'),
      parent: optString.describe('uuid of the parent node; omit for scene root'),
      components: z.array(z.string()).optional().describe('component class names, e.g. ["cc.Sprite"]'),
      assetUuid: optString.describe('asset uuid to create the node from (optional)'),
    },
    run: (a) => client.call('scene.createNode', { parent: a.parent || null, name: a.name, components: a.components, assetUuid: a.assetUuid }),
  },
  {
    name: 'scene_remove_node',
    title: 'Remove node',
    description: 'Remove a node by uuid.',
    schema: { uuid: z.string().describe('node uuid') },
    run: (a) => client.call('scene.removeNode', { uuid: a.uuid }),
  },
  {
    name: 'scene_set_parent',
    title: 'Set node parent',
    description: 'Reparent one or more nodes under a parent node.',
    schema: {
      parent: z.string().describe('parent node uuid'),
      uuids: strArray.describe('uuids of the nodes to move'),
      keepWorldTransform: z.boolean().optional().describe('keep world transform (default false)'),
    },
    run: (a) => client.call('scene.setParent', { parent: a.parent, uuids: a.uuids, keepWorldTransform: a.keepWorldTransform }),
  },
  {
    name: 'scene_duplicate_node',
    title: 'Duplicate node',
    description: 'Duplicate one or more nodes; returns the new uuids.',
    schema: { uuids: strArray.describe('uuids of nodes to duplicate') },
    run: (a) => client.call('scene.duplicateNode', { uuids: a.uuids }),
  },
  {
    name: 'scene_list_components',
    title: 'List components on a node',
    description: 'List component class names on a node (by path or uuid).',
    schema: { pathOrUuid: z.string().describe('node path or uuid') },
    run: (a) => client.call('scene.listComponents', { pathOrUuid: a.pathOrUuid }),
  },

  // ------------------------------------------------- components / properties
  {
    name: 'scene_set_property',
    title: 'Set property',
    description: 'Set a property on a node/component by uuid + property path + dump value. path examples: "position", "name", "__comps__.1.string" (Label text). dump is the serialized property value.',
    schema: {
      uuid: z.string().describe('uuid of the node or component'),
      path: z.string().describe('property path, e.g. "position", "name"'),
      dump: z.any().describe('the serialized value to set (JSON)'),
    },
    run: (a) => client.call('scene.setProperty', { uuid: a.uuid, path: a.path, dump: a.dump }),
  },
  {
    name: 'scene_add_component',
    title: 'Add component',
    description: 'Add a component to a node. `component` is a class name (e.g. "cc.Sprite") or classId.',
    schema: {
      uuid: z.string().describe('node uuid'),
      component: z.string().describe('component class name, e.g. "cc.Sprite"'),
    },
    run: (a) => client.call('scene.addComponent', { uuid: a.uuid, component: a.component }),
  },
  {
    name: 'scene_remove_component',
    title: 'Remove component',
    description: 'Remove a component by its component uuid.',
    schema: { uuid: z.string().describe('component uuid') },
    run: (a) => client.call('scene.removeComponent', { uuid: a.uuid }),
  },
  {
    name: 'scene_execute_component_method',
    title: 'Execute component method',
    description: 'Call a method on a component (e.g. a custom script method).',
    schema: {
      uuid: z.string().describe('component uuid'),
      name: z.string().describe('method name'),
      args: z.array(z.any()).optional().describe('arguments'),
    },
    run: (a) => client.call('scene.executeComponentMethod', { uuid: a.uuid, name: a.name, args: a.args || [] }),
  },
  {
    name: 'scene_list_component_classes',
    title: 'List component classes',
    description: 'List all component classes available in the engine/project (for choosing what to add).',
    schema: {},
    run: () => client.call('scene.queryComponents'),
  },

  // ------------------------------------------------------------ scene lifecycle
  { name: 'scene_save', title: 'Save scene', description: 'Save the currently open scene.', schema: {}, run: () => client.call('scene.save') },
  { name: 'scene_open', title: 'Open scene', description: 'Open a scene asset by its uuid.', schema: { uuid: z.string().describe('scene asset uuid') }, run: (a) => client.call('scene.open', { uuid: a.uuid }) },
  { name: 'scene_close', title: 'Close scene', description: 'Close the currently open scene.', schema: {}, run: () => client.call('scene.close') },
  { name: 'scene_refresh', title: 'Refresh scene view', description: 'Take a fresh snapshot of the scene (refresh the editor scene view after scripted changes).', schema: {}, run: () => client.call('scene.snapshot') },
  { name: 'scene_soft_reload', title: 'Soft reload scene', description: 'Soft-reload the current scene.', schema: {}, run: () => client.call('scene.softReload') },

  // ------------------------------------------------------------ code execution
  {
    name: 'scene_eval',
    title: 'Run JS in scene (engine access)',
    description: 'Execute arbitrary JavaScript in the Cocos scene process with full engine access. Injected: cc, Editor, director, scene, find, require. Example: "const n = new cc.Node(\'x\'); scene.addChild(n); return n.name;". Prefer structured tools when possible.',
    schema: { code: z.string().describe('JavaScript to evaluate; may return a value') },
    run: (a) => client.call('scene.eval', { code: a.code }),
  },
  {
    name: 'editor_eval',
    title: 'Run JS in editor (Node)',
    description: 'Execute arbitrary JavaScript in the editor main process (Node.js + Editor global). Injected: Editor, require, process, module, console, __dirname. Powerful but use carefully.',
    schema: { code: z.string().describe('JavaScript to evaluate; may return a value') },
    run: (a) => client.call('editor.eval', { code: a.code }),
  },

  // ------------------------------------------------------------------- assets
  {
    name: 'asset_list',
    title: 'List assets',
    description: "List assets matching a glob pattern (e.g. 'db://assets/**'). Returns asset info array.",
    schema: { pattern: optString.describe("glob pattern, default 'db://assets/**'") },
    run: (a) => client.call('asset.queryAssets', { pattern: a.pattern }),
  },
  { name: 'asset_info', title: 'Asset info', description: 'Return basic info for an asset by url or uuid.', schema: { urlOrUuid: z.string().describe('asset url (db://...) or uuid') }, run: (a) => client.call('asset.queryInfo', { urlOrUuid: a.urlOrUuid }) },
  { name: 'asset_meta', title: 'Asset meta', description: 'Return the .meta information for an asset.', schema: { urlOrUuid: z.string() }, run: (a) => client.call('asset.queryMeta', { urlOrUuid: a.urlOrUuid }) },
  {
    name: 'asset_create',
    title: 'Create asset',
    description: "Create a new asset. If content is null, creates a folder; otherwise writes content to the file (url like 'db://assets/foo.ts').",
    schema: { url: z.string().describe('asset url, e.g. db://assets/foo.ts'), content: z.string().nullable().optional().describe('file content, or null for a folder') },
    run: (a) => client.call('asset.create', { url: a.url, content: a.content == null ? null : a.content }),
  },
  {
    name: 'asset_import',
    title: 'Import asset',
    description: 'Import a local file/folder into the asset database.',
    schema: { source: z.string().describe('absolute local path'), target: z.string().describe('target db url, e.g. db://assets/') },
    run: (a) => client.call('asset.import', { source: a.source, target: a.target }),
  },
  { name: 'asset_delete', title: 'Delete asset', description: 'Delete an asset by url/uuid/path.', schema: { url: z.string() }, run: (a) => client.call('asset.delete', { url: a.url }) },
  { name: 'asset_save', title: 'Save asset content', description: 'Overwrite an asset file with new text content.', schema: { urlOrUuid: z.string(), content: z.string() }, run: (a) => client.call('asset.save', { urlOrUuid: a.urlOrUuid, content: a.content }) },
  { name: 'asset_reimport', title: 'Reimport asset', description: 'Reimport an asset (refresh import pipeline).', schema: { urlOrUuid: z.string() }, run: (a) => client.call('asset.reimport', { urlOrUuid: a.urlOrUuid }) },
  {
    name: 'asset_read_file',
    title: 'Read project file',
    description: 'Read a text file inside the project (project-relative path, e.g. "assets/scripts/Game.ts").',
    schema: { path: z.string().describe('project-relative path') },
    run: (a) => client.call('asset.readFile', { path: a.path }),
  },
  {
    name: 'asset_write_file',
    title: 'Write project file',
    description: 'Write a text file inside the project and import it into the asset database (e.g. create a component script).',
    schema: { path: z.string().describe('project-relative path, e.g. assets/scripts/Game.ts'), content: z.string().describe('file content') },
    run: (a) => client.call('asset.writeFile', { path: a.path, content: a.content }),
  },
  { name: 'asset_uuid_of_url', title: 'URL to UUID', description: 'Resolve an asset url to its uuid.', schema: { url: z.string() }, run: (a) => client.call('asset.queryUuid', { url: a.url }) },
  { name: 'asset_url_of_uuid', title: 'UUID to URL', description: 'Resolve an asset uuid to its url.', schema: { uuid: z.string() }, run: (a) => client.call('asset.queryUrl', { uuid: a.uuid }) },
  { name: 'asset_path_of', title: 'Asset to disk path', description: 'Resolve an asset (url/uuid) to its absolute disk path.', schema: { urlOrUuid: z.string() }, run: (a) => client.call('asset.queryPath', { urlOrUuid: a.urlOrUuid }) },

  // ------------------------------------------------------------- build / preview
  {
    name: 'build_run',
    title: 'Run headless build',
    description: 'Trigger a command-line build. `platform` examples: web-mobile, web-desktop, win32, android, ios, mac. Optional: buildPath, debug, startScene (scene uuid), name.',
    schema: {
      platform: z.string().describe('target platform, e.g. web-mobile'),
      buildPath: optString.describe('output path (default project://build)'),
      debug: z.boolean().optional(),
      name: optString.describe('build name'),
      startScene: optString.describe('start scene uuid'),
      extraArgs: optString.describe('raw extra "key=value;..." pairs appended to --build'),
    },
    run: async (a) => {
      const buildArgs = [];
      if (a.extraArgs) buildArgs.push(a.extraArgs);
      const opts = { platform: a.platform, debug: a.debug, buildPath: a.buildPath, name: a.name, startScene: a.startScene };
      if (buildArgs.length) opts.buildArgs = buildArgs.join(';');
      return client.call('build.run', opts);
    },
  },
  { name: 'build_open_panel', title: 'Open build panel', description: 'Open the Build panel in the editor.', schema: {}, run: () => client.call('build.openPanel') },
  { name: 'preview_open', title: 'Open preview terminal', description: 'Open the browser/simulator preview terminal.', schema: {}, run: () => client.call('preview.open') },
  { name: 'preview_reload', title: 'Reload preview', description: 'Reload the preview terminal.', schema: {}, run: () => client.call('preview.reload') },
  { name: 'preview_query_url', title: 'Preview URL', description: 'Return the current preview URL.', schema: {}, run: () => client.call('preview.queryUrl') },

  // ------------------------------------------------------------- selection
  {
    name: 'selection_select',
    title: 'Select node/asset',
    description: "Select an element in the editor by type ('node' or 'asset') and uuid.",
    schema: { type: z.string().describe("'node' or 'asset'"), uuid: z.string().describe('uuid') },
    run: (a) => client.call('selection.select', { type: a.type, uuid: a.uuid }),
  },
  {
    name: 'selection_clear',
    title: 'Clear selection',
    description: "Clear the current selection for a type ('node' or 'asset').",
    schema: { type: z.string().describe("'node' or 'asset'") },
    run: (a) => client.call('selection.clear', { type: a.type }),
  },
];

async function main() {
  const server = new McpServer({
    name: 'cocos-mcp',
    version: '1.0.0',
  });

  for (const t of tools) {
    const inputSchema = Object.keys(t.schema).length ? t.schema : undefined;
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema },
      async (args) => {
        try {
          return text(await t.run(args || {}));
        } catch (e) {
          return { content: [{ type: 'text', text: 'ERROR: ' + (e && e.message ? e.message : String(e)) }], isError: true };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for diagnostics; stdio is reserved for the MCP protocol.
  process.stderr.write('[cocos-mcp] ready, ' + tools.length + ' tools registered\n');
}

main().catch((err) => {
  process.stderr.write('[cocos-mcp] fatal: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
