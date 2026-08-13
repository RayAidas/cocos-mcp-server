# scene_eval 常用脚本示例库

这些脚本供 `scene_eval` 工具的 `code` 参数直接使用。`scene_eval` 已在作用域里注入：

| 变量 | 含义 |
| --- | --- |
| `cc` | 整个引擎模块（`cc.Node`、`cc.Sprite`、`cc.v3`…） |
| `scene` | 当前打开的场景根节点 |
| `director` | `cc.director` |
| `find` | `cc.find`（按路径找节点） |
| `require` | 可加载项目脚本与引擎模块 |

> 注意：`scene_eval` 的返回值会经过 JSON 序列化，所以脚本最后 **return 字符串/数字/普通对象**，不要 return 引擎对象本身。

---

## 1. 创建 Canvas（UI 根节点）

```js
const canvas = new cc.Node('Canvas');
canvas.addComponent(cc.Canvas);
canvas.addComponent(cc.UITransform);
scene.addChild(canvas);
return 'created Canvas';
```

## 2. 创建文本 Label

```js
const canvas = find('Canvas') || scene.getChildByName('Canvas');
const label = new cc.Node('Label');
label.addComponent(cc.UITransform);
const l = label.addComponent(cc.Label);
l.string = 'Hello Cocos';
l.fontSize = 40;
label.setPosition(0, 100, 0);
(canvas || scene).addChild(label);
return 'created Label';
```

## 3. 创建按钮 Button

```js
const canvas = find('Canvas') || scene.getChildByName('Canvas');
const btn = new cc.Node('Button');
btn.addComponent(cc.UITransform);
const sp = btn.addComponent(cc.Sprite);
sp.color = new cc.Color(80, 140, 255, 255);
const b = btn.addComponent(cc.Button);
b.target = btn;
(canvas || scene).addChild(btn);
return 'created Button';
```

## 4. 创建精灵 Sprite（纯色占位）

```js
const canvas = find('Canvas') || scene.getChildByName('Canvas');
const spNode = new cc.Node('Sprite');
spNode.addComponent(cc.UITransform);
const sp = spNode.addComponent(cc.Sprite);
sp.color = new cc.Color(255, 120, 120, 255);
(canvas || scene).addChild(spNode);
return 'created Sprite';
```

## 5. 批量生成方块围成一圈（随机颜色）

```js
const parent = new cc.Node('Ring');
scene.addChild(parent);
const count = 12, radius = 200;
for (let i = 0; i < count; i++) {
  const n = new cc.Node('cube_' + i);
  n.addComponent(cc.UITransform);
  const s = n.addComponent(cc.Sprite);
  s.color = new cc.Color(Math.floor(Math.random()*255), Math.floor(Math.random()*255), Math.floor(Math.random()*255), 255);
  const ang = (Math.PI * 2 / count) * i;
  n.setPosition(Math.cos(ang) * radius, Math.sin(ang) * radius, 0);
  parent.addChild(n);
}
return 'created ' + count + ' sprites';
```

## 6. 创建 3D 物体（Cube 节点 + MeshRenderer）

```js
const cube = new cc.Node('Cube');
cube.addComponent(cc.MeshRenderer);
scene.addChild(cube);
cube.setPosition(0, 0, 5);
return 'created Cube node';
```

## 7. 查找节点并改属性

```js
const n = find('Canvas/Label');
if (n) {
  const label = n.getComponent(cc.Label);
  if (label) label.string = 'Updated by AI';
  return 'updated Canvas/Label';
}
return 'Canvas/Label not found';
```

## 8. 移动 / 缩放 / 旋转节点

```js
const n = find('Canvas/Label');
if (!n) return 'not found';
n.setPosition(120, -80, 0);
n.setScale(1.5, 1.5, 1);
n.angle = 15;               // 2D 旋转角度
return 'transformed ' + n.name;
```

## 9. 遍历并打印场景节点树

```js
function walk(n, d) {
  let s = '  '.repeat(d) + n.name;
  if (n.uuid) s += '  [' + n.uuid + ']';
  s += '\n';
  (n.children || []).forEach(function (c) { s += walk(c, d + 1); });
  return s;
}
return '\n' + walk(scene, 0);
```

## 10. 删除节点（按路径）

```js
const n = find('Canvas/Label');
if (!n) return 'not found';
n.destroy();
return 'destroyed Canvas/Label';
```

## 11. 复制一个节点到新位置

```js
const src = find('Canvas/Label');
if (!src) return 'not found';
const copy = cc.instantiate(src);
copy.name = src.name + '_copy';
copy.parent = src.parent;
copy.setPosition(src.position.x + 50, src.position.y, src.position.z);
return 'cloned to ' + copy.name;
```

## 12. 给节点加自定义脚本组件

```js
// 前提：项目里已有名为 MyScript 的组件脚本（在 assets 里）
const n = find('Canvas') || scene;
const comp = n.addComponent('MyScript'); // 用脚本类名
return 'added MyScript -> ' + (comp ? 'ok' : 'failed');
```

---

## 用法

在 AI 客户端里，把上面某个脚本的**代码块内容**填给 `scene_eval`，例如：

> 用 scene_eval 执行：在场景里创建 12 个随机颜色方块围成一圈。

AI 会自己选用 `scene_eval` 工具并填入对应代码。你也可以直接对 AI 说目标（"创建一圈方块"），让它参考本文件挑选或改编。

> 提示：脚本改动在编辑器里需要调用 `scene_refresh`（快照）才会立刻反映到 Hierarchy 面板；保存场景用 `scene_save`。
