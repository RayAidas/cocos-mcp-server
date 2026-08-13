# 工具清单（MCP Tools）

`cocos-mcp` 共暴露 42 个 MCP 工具。下面按类别列出名称、参数与用途。参数里 `?` 表示可选。

## 元信息

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `ping` | — | 检测扩展连通性，返回健康/项目信息 |
| `project_info` | — | 返回项目名、路径、uuid、编辑器版本 |

## 场景 · 节点

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `scene_get_tree` | — | 导出当前场景根节点（节点/变换/组件/子节点树） |
| `scene_query_node` | `uuid` | 按 uuid 查询节点的编辑器完整 dump |
| `scene_find_node` | `pathOrUuid` | 按路径（如 `Canvas/Label`）或 uuid 查节点 |
| `scene_create_node` | `name`, `parent?`, `components?[]`, `assetUuid?` | 创建节点；`components` 如 `["cc.Sprite"]` |
| `scene_remove_node` | `uuid` | 删除节点 |
| `scene_set_parent` | `parent`, `uuids[]`, `keepWorldTransform?` | 把节点挂到新父节点 |
| `scene_duplicate_node` | `uuids[]` | 复制节点，返回新 uuid |
| `scene_list_components` | `pathOrUuid` | 列出某节点的组件类名 |

## 场景 · 组件 / 属性

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `scene_set_property` | `uuid`, `path`, `dump` | 设置属性；`path` 如 `position`、`name`、`__comps__.1.string` |
| `scene_add_component` | `uuid`, `component` | 加组件；`component` 如 `cc.Sprite` |
| `scene_remove_component` | `uuid` | 删组件（组件 uuid） |
| `scene_execute_component_method` | `uuid`, `name`, `args?[]` | 调用组件（含自定义脚本）方法 |
| `scene_list_component_classes` | — | 列出引擎/项目里所有可用组件类 |

## 场景 · 生命周期

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `scene_save` | — | 保存当前场景 |
| `scene_open` | `uuid` | 打开场景资源 |
| `scene_close` | — | 关闭当前场景 |
| `scene_refresh` | — | 刷新场景视图（脚本改动后同步显示） |
| `scene_soft_reload` | — | 软重载场景 |

## 代码执行

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `scene_eval` | `code` | 在场景进程执行 JS，注入 `cc/Editor/director/scene/find/require` |
| `editor_eval` | `code` | 在编辑器主进程执行 JS，注入 `Editor/require/process/module/console/__dirname` |

`scene_eval` 示例：

```js
const n = new cc.Node('Hi');
scene.addChild(n);
return n.name;
```

## 资源

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `asset_list` | `pattern?` | 按 glob 列出资源（默认 `db://assets/**`） |
| `asset_info` | `urlOrUuid` | 资源基本信息 |
| `asset_meta` | `urlOrUuid` | 资源 .meta 信息 |
| `asset_create` | `url`, `content?` | 创建资源；`content` 为 `null` 则建目录 |
| `asset_import` | `source`, `target` | 从本地导入文件/目录 |
| `asset_delete` | `url` | 删除资源 |
| `asset_save` | `urlOrUuid`, `content` | 覆盖资源文件内容 |
| `asset_reimport` | `urlOrUuid` | 重新导入资源 |
| `asset_read_file` | `path` | 读项目内文本文件（`assets/scripts/Game.ts`） |
| `asset_write_file` | `path`, `content` | 写项目内文件并导入（如创建组件脚本） |
| `asset_uuid_of_url` | `url` | url → uuid |
| `asset_url_of_uuid` | `uuid` | uuid → url |
| `asset_path_of` | `urlOrUuid` | 资源 → 磁盘绝对路径 |

## 构建 / 预览

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `build_run` | `platform`, `buildPath?`, `debug?`, `name?`, `startScene?`, `extraArgs?` | 无头命令行构建 |
| `build_open_panel` | — | 打开构建面板 |
| `preview_open` | — | 打开预览终端 |
| `preview_reload` | — | 刷新预览终端 |
| `preview_query_url` | — | 返回当前预览 URL |

`build_run` 的 `platform` 示例：`web-mobile`、`web-desktop`、`win32`、`android`、`ios`、`mac`。

## 选择

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `selection_select` | `type` (`node`/`asset`), `uuid` | 选中元素 |
| `selection_clear` | `type` | 清除某类选中 |
