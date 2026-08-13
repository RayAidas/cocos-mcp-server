'use strict';

/**
 * Shared, dependency-free helpers used by both the extension main process
 * (main.js) and the scene script (scene.js).
 *
 * IMPORTANT: everything that crosses `execute-scene-script` / `Editor.Message`
 * boundaries is serialized as JSON by the editor's IPC layer. We therefore
 * convert engine objects into plain JSON before returning.
 */

const MAX_DEPTH = 6;
const MAX_ITEMS = 200;
const MAX_KEYS = 200;

function typeNameOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' && typeof value !== 'function') return typeof value;
  if (typeof value === 'function') return 'function';
  // cc engine classes expose __classname__ (e.g. 'cc.Node', 'cc.Sprite')
  if (typeof value.__classname__ === 'string') return value.__classname__;
  const ctor = value.constructor;
  if (ctor && typeof ctor.name === 'string' && ctor.name) return ctor.name;
  return null;
}

function serializeVecLike(value, depth, seen) {
  const out = {};
  const keys = ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a', 'width', 'height', 'u', 'v', 'i', 'j', 'k'];
  let found = false;
  for (const k of keys) {
    if (typeof value[k] === 'number') {
      out[k] = value[k];
      found = true;
    }
  }
  if (found) {
    out.__type__ = typeNameOf(value);
    return out;
  }
  return null;
}

function serializeNode(node, depth, seen) {
  const out = {
    __type__: typeNameOf(node),
    name: node.name,
    active: node.active,
  };
  if (node.activeInHierarchy !== undefined) out.activeInHierarchy = node.activeInHierarchy;
  if (typeof node.uuid === 'string') out.uuid = node.uuid;
  if (node.layer !== undefined) out.layer = node.layer;

  // Transform
  try {
    if (node.position) out.position = serialize(node.position, depth + 1, seen);
    if (node.rotation) out.rotation = serialize(node.rotation, depth + 1, seen);
    if (node.scale) out.scale = serialize(node.scale, depth + 1, seen);
    if (node.eulerAngles) out.eulerAngles = serialize(node.eulerAngles, depth + 1, seen);
  } catch (_e) { /* ignore transform errors */ }

  // Components
  try {
    if (Array.isArray(node.components)) {
      out.components = node.components.slice(0, MAX_ITEMS).map(function (c) {
        const o = { __type__: typeNameOf(c) };
        if (c && typeof c.enabled === 'boolean') o.enabled = c.enabled;
        if (c && typeof c.uuid === 'string') o.uuid = c.uuid;
        return o;
      });
    }
  } catch (_e) { /* ignore */ }

  // Children
  try {
    if (Array.isArray(node.children)) {
      out.children = node.children.slice(0, MAX_ITEMS).map(function (c) {
        return serialize(c, depth + 1, seen);
      });
    }
  } catch (_e) { /* ignore */ }

  return out;
}

function serialize(value, depth, seen) {
  if (depth === undefined) depth = 0;
  if (seen === undefined) seen = new WeakSet();

  if (value === undefined) return undefined;
  if (value === null) return null;

  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : String(value);
  if (t === 'bigint') return value.toString();
  if (t === 'symbol') return String(value);
  if (t === 'function') return '[Function ' + (value.name || 'anonymous') + ']';

  // object
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth: ' + typeNameOf(value) + ']';
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ITEMS).map(function (v) { return serialize(v, depth + 1, seen); });
    }
    if (ArrayBuffer.isView(value)) {
      return Array.from(value).slice(0, MAX_ITEMS);
    }
    if (value instanceof Date) return value.toISOString();

    const typeName = typeNameOf(value);

    // cc.Node / cc.Scene
    if (typeName === 'cc.Node' || typeName === 'cc.Scene') {
      return serializeNode(value, depth, seen);
    }

    // Vec2/Vec3/Vec4/Quat/Color/Size/Rect/Mat-like
    const vecLike = serializeVecLike(value, depth, seen);
    if (vecLike) return vecLike;

    // Generic object: dump top-level enumerable properties.
    const out = {};
    let count = 0;
    for (const k of Object.keys(value)) {
      if (count++ >= MAX_KEYS) break;
      if (k === '_id' || k === 'hideFlags') continue; // skip noisy internals
      try {
        out[k] = serialize(value[k], depth + 1, seen);
      } catch (e) {
        out[k] = '[Error: ' + (e && e.message) + ']';
      }
    }
    return out;
  } catch (e) {
    return '[Unserializable: ' + (e && e.message) + ']';
  }
}

module.exports = {
  serialize: serialize,
  typeNameOf: typeNameOf,
};
