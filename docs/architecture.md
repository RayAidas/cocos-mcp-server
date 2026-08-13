# 架构与协议

## 总览

`cocos-mcp` 由两个独立进程组成，中间以本机 HTTP JSON-RPC 通信：

```
┌────────────────────┐        MCP (JSON-RPC 2.0, stdio)        ┌──────────────────────┐
│   AI 客户端         │◀──────────────────────────────────────▶│  cocos-mcp server    │
│ (Claude/Cursor/…)  │                                         │  (Node.js, stdio)    │
└────────────────────┘                                         └──────────┬───────────┘
                                                                          │ HTTP JSON-RPC 2.0
                                                                          │ POST http://127.0.0.1:32123/rpc
                                                                          ▼
                                                                ┌──────────────────────┐
                                                                │  cc-mcp 扩展          │
                                                                │  (Cocos Creator 内)   │
                                                                │  ┌────────────────┐  │
                                                                │  │ main.js (主进程) │  │  ── Editor.Message.request(...)
                                                                │  │ scene.js (场景)  │  │  ── execute-scene-script
                                                                │  └────────────────┘  │
                                                                └──────────────────────┘
```

**为什么拆成两层？**

1. Cocos Creator 的编辑器扩展运行在 Electron 的多进程环境里，其主进程可以访问 `Editor` API 和 Node 内置模块，但不方便直接暴露 MCP。
2. MCP 是一个标准协议，AI 客户端通过 stdio 启动一个子进程即可接入，不需要感知编辑器内部结构。
3. 中间用本机 HTTP JSON-RPC 连接，既能解耦，也方便用 `curl` 调试。

## 进程与职责

### 1. `extension/`（cc-mcp，编辑器扩展）

- **`main.js`**（编辑器主进程）：
  - 用 Node 内置 `http` 模块启动本机 JSON-RPC 服务（默认 `127.0.0.1:32123`）。
  - 实现命令分发：把方法名映射到 `Editor.Message.request('scene'|'asset-db'|'builder'|'preview', …)` 或 Node API。
  - 实现 `editor.eval`（主进程任意 JS）、`build.run`（spawn 无头 CLI 构建）。
- **`scene.js`**（场景脚本，`contributions.scene.script`）：
  - 运行在场景进程，与项目脚本同运行时，可 `require('cc')` 访问整个引擎。
  - 实现 `eval`（场景任意 JS，注入 `cc/Editor/director/scene/find/require`）、`getSceneTree`、`findNode`、`listComponents`。
  - 通过 `Editor.Message.request('scene', 'execute-scene-script', {name, method, args})` 被主进程调用。
- **`shared.js`**：无依赖的序列化工具，把引擎对象（Node/Vec3/Color/组件…）转成纯 JSON，避免 IPC 序列化崩溃与循环引用。

### 2. `mcp-server/`（cocos-mcp，MCP Server）

- 使用官方 `@modelcontextprotocol/sdk`，通过 `StdioServerTransport` 提供 MCP 服务。
- 把每个 MCP 工具映射为一次 `CocosClient.call(method, params)` 的 HTTP JSON-RPC 调用。
- 配置通过环境变量：`CC_MCP_URL`（默认 `http://127.0.0.1:32123`）、`CC_MCP_TOKEN`（可选）。

## 协议：HTTP JSON-RPC 2.0

扩展对外暴露：

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 健康检查，返回项目信息与所有可用方法名 |
| `/rpc` | POST | JSON-RPC 2.0（单条或批量数组） |

请求体：

```json
{ "jsonrpc": "2.0", "id": 1, "method": "scene.createNode", "params": { "parent": null, "name": "Player" } }
```

响应体（成功）：

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "uuid": "..." } }
```

响应体（失败）：

```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32603, "message": "…", "data": ["stack…"] } }
```

方法命名约定：`域.动作`，例如 `scene.createNode`、`asset.queryInfo`、`build.run`。完整方法列表见 `/health` 的 `methods` 字段。

## 关键编辑器 API（已核对 3.8.7）

| 能力 | 调用 |
| --- | --- |
| 创建节点 | `Editor.Message.request('scene', 'create-node', { parent, name, components, assetUuid })` |
| 查询节点 | `Editor.Message.request('scene', 'query-node', uuid)` |
| 设置属性 | `Editor.Message.request('scene', 'set-property', { uuid, path, dump })` |
| 加组件 | `Editor.Message.request('scene', 'create-component', { uuid, component })` |
| 执行场景脚本 | `Editor.Message.request('scene', 'execute-scene-script', { name, method, args })` |
| 资源查询 | `Editor.Message.request('asset-db', 'query-assets', pattern)` |
| 资源导入 | `Editor.Message.request('asset-db', 'import-asset', source, target, option)` |
| 打开构建面板 | `Editor.Message.request('builder', 'open')` |
| 无头构建 | spawn `CocosCreator --project <p> --build "platform=…;…"` |

> 消息名与参数签名摘自 3.8.7 的 `builtin/scene/i18n/en/contributions/messages.js` 与
> `builtin/asset-db/i18n/en.js`，并参考官方文档 [Message System](https://docs.cocos.com/creator/manual/en/editor/extension/messages.html) 与
> [Calling the Engine API and Project Script](https://docs.cocos.com/creator/manual/en/editor/extension/scene-script.html)。

## 扩展

- **加新工具**：在 `mcp-server/src/index.js` 的 `tools` 数组里加一条定义，必要时在 `extension/main.js` 的 `handlers` 里加对应方法即可。
- **换传输**：如需 MCP over SSE/HTTP，可将 `StdioServerTransport` 换成 `StreamableHTTPServerTransport`（SDK 已内置），后端不变。
