'use strict';

/**
 * cc-mcp scene script.
 *
 * Runs inside the Cocos Creator "scene" process — the same runtime as the
 * project's own scripts — and therefore has full access to the `cc` engine
 * module and to project scripts.
 *
 * It is called from the extension main process via:
 *   Editor.Message.request('scene', 'execute-scene-script', { name, method, args })
 */

const path = require('path');

// Add the editor's bundled node_modules so that `require('cc')` resolves.
try {
  if (typeof Editor !== 'undefined' && Editor.App && Editor.App.path) {
    module.paths.push(path.join(Editor.App.path, 'node_modules'));
  }
} catch (_e) { /* ignore */ }

const cc = require('cc');
const shared = require('./shared.js');

function findByUuid(root, uuid) {
  if (!root) return null;
  if (root.uuid === uuid) return root;
  const children = root.children;
  if (children) {
    for (let i = 0; i < children.length; i++) {
      const found = findByUuid(children[i], uuid);
      if (found) return found;
    }
  }
  return null;
}

function getScene() {
  const director = cc.director;
  return director && director.getScene ? director.getScene() : null;
}

function buildEvalScope() {
  const director = cc.director;
  const scene = getScene();
  return { cc, Editor, director, scene, find: cc.find, require };
}

exports.load = function load() {};
exports.unload = function unload() {};

exports.methods = {
  /**
   * Evaluate arbitrary JavaScript in the scene process with the engine
   * available. The code is wrapped as a function body and may `return` a value.
   *
   * Injected identifiers: cc, Editor, director, scene, find, require.
   * Example code: `const n = new cc.Node('hi'); scene.addChild(n); return n.name;`
   */
  async eval(code) {
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error('code must be a non-empty string');
    }
    const scope = buildEvalScope();
    // Direct eval so the returned function closes over the local scope; the
    // function body only uses its explicit parameters.
    const factory = eval('(function (cc, Editor, director, scene, find, require) {\n' + code + '\n})');
    const result = factory(scope.cc, scope.Editor, scope.director, scope.scene, scope.find, scope.require);
    return shared.serialize(await result);
  },

  /** Serialized dump of the currently open scene root node (with children). */
  getSceneTree() {
    const scene = getScene();
    if (!scene) return { error: 'no scene is currently open' };
    return shared.serialize(scene);
  },

  /** Find a node by path (e.g. 'Canvas/Label') or by node uuid. */
  findNode(pathOrUuid) {
    const scene = getScene();
    if (!scene) return null;
    if (typeof pathOrUuid !== 'string') return null;
    const byPath = cc.find(pathOrUuid);
    if (byPath) return shared.serialize(byPath);
    const byUuid = findByUuid(scene, pathOrUuid);
    if (byUuid) return shared.serialize(byUuid);
    return null;
  },

  /** List component class names present on a node (by path or uuid). */
  listComponents(pathOrUuid) {
    const scene = getScene();
    if (!scene) return [];
    let node = null;
    if (typeof pathOrUuid === 'string') {
      node = cc.find(pathOrUuid) || findByUuid(scene, pathOrUuid);
    }
    if (!node || !Array.isArray(node.components)) return [];
    return node.components.map(function (c) {
      return shared.typeNameOf(c) || (c && c.constructor && c.constructor.name);
    });
  },
};
