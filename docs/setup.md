# 接入步骤

## 一、前置条件

- Cocos Creator **3.8.x**（已在本机验证 3.8.7）
- Node.js ≥ 18（MCP Server 依赖 `fetch`）
- 一个已有的 Cocos Creator 项目

## 二、安装扩展

```bash
cd /Users/rayaidas/Project/cocos-mcp-server

# 复制到项目（推荐）
./scripts/install-extension.sh /path/to/your-cocos-project

# 或软链（开发时改动实时生效）
./scripts/install-extension.sh /path/to/your-cocos-project --link
```

安装后在 Cocos Creator 里打开项目，并 **Extension → Extension Manager** 里刷新/启用 `cc-mcp`（或直接重启编辑器）。

验证（浏览器或 curl）：

```bash
curl http://127.0.0.1:32123/health
# {"status":"ok","service":"cc-mcp","project":"...","methods":[...]}
```

### 固定端口 / 多开编辑器

推荐在 **Cocos 项目根目录** 放 `.cc-mcp.json`（`install-extension.sh` 首次安装会自动创建）：

```json
{
  "port": 32123,
  "strictPort": true
}
```

- `port`：本项目的 HTTP 监听端口。
- `strictPort: true`：端口被占用时**失败**，不会自动 `+1` 顺延（避免 AI 连错项目）。
- 未配置 `.cc-mcp.json` 且未设置 `CC_MCP_PORT` 时，仍使用默认 `32123`，并在冲突时自动尝试最多 +20 个端口（旧行为）。

多开示例：项目 A 用 `32123`，项目 B 用 `32130`；在 Cursor 里为 B 增加第二个 MCP server，并设置 `CC_MCP_URL=http://127.0.0.1:32130`。

也可用环境变量（需在**启动 Cocos 的终端**里 export，从 Dock 点开编辑器时通常读不到）：

- 扩展侧：`CC_MCP_PORT=32130`
- MCP 侧：`CC_MCP_URL=http://127.0.0.1:32130`

模板见 `examples/cc-mcp.project.json`。

### 可选鉴权

两端都设置相同的 `CC_MCP_TOKEN`：

- 扩展侧：启动编辑器前 `export CC_MCP_TOKEN=your-secret`。
- MCP 侧：客户端配置里加 `CC_MCP_TOKEN` 环境变量。

## 三、安装 MCP Server 依赖

```bash
cd /Users/rayaidas/Project/cocos-mcp-server/mcp-server
npm install
```

## 四、在各 AI 客户端注册

MCP Server 入口为：

```bash
node /Users/rayaidas/Project/cocos-mcp-server/mcp-server/src/index.js
```

> ⚠️ **node 绝对路径**：GUI 客户端（Claude Desktop / Cursor）通常不加载 shell 的 PATH，如果你是用 nvm 装的 node，`"command": "node"` 会找不到。下面配置里已写死绝对路径 `/Users/rayaidas/.nvm/versions/node/v22.23.2/bin/node`。你自己的 node 路径用 `which node` 查询，若不同请替换成实际路径。

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "cocos": {
      "command": "/Users/rayaidas/.nvm/versions/node/v22.23.2/bin/node",
      "args": ["/Users/rayaidas/Project/cocos-mcp-server/mcp-server/src/index.js"],
      "env": {
        "CC_MCP_URL": "http://127.0.0.1:32123"
      }
    }
  }
}
```

### Cursor

`Settings → MCP → Add new MCP server`，Command 填：

```
node /Users/rayaidas/Project/cocos-mcp-server/mcp-server/src/index.js
```

或在项目 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "cocos": {
      "command": "/Users/rayaidas/.nvm/versions/node/v22.23.2/bin/node",
      "args": ["/Users/rayaidas/Project/cocos-mcp-server/mcp-server/src/index.js"]
    }
  }
}
```

### VS Code (Copilot / Cline 等)

`.vscode/mcp.json`：

```json
{
  "servers": {
    "cocos": {
      "type": "stdio",
      "command": "/Users/rayaidas/.nvm/versions/node/v22.23.2/bin/node",
      "args": ["/Users/rayaidas/Project/cocos-mcp-server/mcp-server/src/index.js"]
    }
  }
}
```

### 通用 / 自定义 Agent

任何能执行 stdio MCP 客户端的 Agent 均可；也可直接跳过 MCP、用 HTTP 调用扩展：

```bash
curl -s http://127.0.0.1:32123/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"scene.createNode","params":{"name":"Player","components":["cc.Sprite"]}}'
```

## 五、验证 MCP

先跑一键自检：

```bash
cd /Users/rayaidas/Project/cocos-mcp-server
node scripts/check.mjs
```

应显示依赖、扩展、MCP 工具数全部 ✔。

连接后让 AI 执行 `ping` 或 `project_info`，应返回编辑器当前项目信息；再执行 `scene_get_tree` 应返回场景结构。

常用 `scene_eval` 脚本（创建 Canvas/按钮/文本、批量生成、改属性等）见 `examples/scene-snippets.md`。

## 六、常见问题

| 现象 | 处理 |
| --- | --- |
| MCP 报 "Cannot reach … cc-mcp extension" | 确认 Cocos Creator 已打开该项目、扩展已启用、`/health` 可访问 |
| 端口不通 | 检查端口是否被占用或设置了自定义 `CC_MCP_PORT`，并同步 `CC_MCP_URL` |
| 场景操作没反应 | 打开一个场景后再操作；部分改动后调用 `scene_refresh` 同步视图 |
| `build_run` 找不到编辑器 | 确认是通过 `Cocos Creator`（非 Dashboard）打开项目；构建用编辑器二进制，需项目已被打开 |
| 扩展未加载 | 看编辑器 Console 面板的 `[cc-mcp]` 日志；确认 `extensions/cc-mcp/package.json` 存在 |
