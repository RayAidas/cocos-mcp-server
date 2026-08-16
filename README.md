# Cocos Creator MCP Agent

通过 **MCP (Model Context Protocol)** 用 AI 控制 [Cocos Creator](https://www.cocos.com/) 3.8 编辑器。

AI 客户端（Claude / Cursor / VS Code / 任何支持 MCP 的 Agent）通过 MCP 协议调用 `cocos-mcp` 服务，该服务再通过本机 HTTP JSON-RPC 驱动编辑器内的 `cc-mcp` 扩展，从而操作场景、节点、组件、资源、构建与预览，甚至直接在编辑器/场景进程里执行任意 JS。

```
┌──────────────┐   MCP (stdio)   ┌───────────────┐   HTTP JSON-RPC   ┌──────────────────────┐
│  AI Client   │ ───────────────▶│  cocos-mcp    │ ─────────────────▶│  cc-mcp 扩展 (编辑器内) │
│ Claude/Cursor│                 │  (Node 进程)   │  127.0.0.1:32123  │  scene / asset / build │
└──────────────┘                 └───────────────┘                   └──────────────────────┘
```

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `extension/` | Cocos Creator 3.8 编辑器扩展（`cc-mcp`），内置 HTTP JSON-RPC 服务 |
| `mcp-server/` | Node.js MCP Server（`cocos-mcp`），stdio 传输，把工具调用转发给扩展 |
| `scripts/install-extension.sh` | 一键安装扩展到你的 Cocos 项目 |
| `docs/` | 架构、工具清单、接入步骤 |

## 快速开始

### 1. 安装扩展到你的 Cocos 项目

```bash
# 方式 A：复制（推荐首次使用）
./scripts/install-extension.sh /path/to/your-cocos-project

# 方式 B：软链（开发时实时生效）
./scripts/install-extension.sh /path/to/your-cocos-project --link
```

在 Cocos Creator 中打开项目，然后 **Extension → Extension Manager → 刷新/重载**（或重启编辑器）。扩展会监听 `http://127.0.0.1:32123`。

验证：浏览器打开 `http://127.0.0.1:32123/health`，应返回 JSON 项目信息。

### 2. 安装 MCP Server 依赖

```bash
cd mcp-server
npm install
```

> **不必手动启动 MCP Server。** Cursor、Claude Desktop 等客户端在配置好 MCP 后，会按下方配置**自动 spawn** `node …/src/index.js` 子进程，并通过 stdio 与之通信。你只需保证 Cocos 编辑器已打开且扩展在运行（第 1 步）。

### 3. 在 AI 客户端中注册

通用 MCP 配置模板（Claude Desktop / Cursor / 其他 stdio MCP 客户端通用）：

```json
{
  "mcpServers": {
    "cocos": {
      "command": "node",
      "args": ["<本仓库路径>/mcp-server/src/index.js"]
    }
  }
}
```

- 把 `<本仓库路径>` 替换为你 clone 本仓库后的**绝对路径**（在仓库根目录执行 `pwd` 查看），例如 `/Users/you/cocos-mcp-server`。
- 若 GUI 客户端找不到 `node`（不加载 shell PATH，nvm 用户常见），用 `which node` 的输出替换 `"command"`，例如 `"/Users/you/.nvm/versions/node/v22.23.2/bin/node"`。
- **Cursor**：把上面的 JSON 写入项目 `.cursor/mcp.json`，或通过 `Settings → MCP → Add new MCP server` 添加。保存后 Cursor 会在需要时自动启动 MCP Server，无需在终端手动运行。
- **Claude Desktop**：写入 `claude_desktop_config.json`；VS Code 使用顶层键 `"servers"`。各客户端完整示例见 [docs/setup.md](docs/setup.md)。

<details>
<summary>（可选）手动启动 MCP Server — 仅用于调试</summary>

若需单独验证 MCP Server 是否正常，可在终端运行：

```bash
cd mcp-server
node src/index.js          # 通过 stdio 运行，等待 MCP 客户端连接
```

正常使用 AI 客户端时不需要此步骤。

</details>

### 4. 让 AI 干活

示例提示词：

> 在场景里创建一个名为 `Player` 的节点，加上 `cc.Sprite` 组件，并把它设为 `Canvas` 的子节点。

> 列出 `db://assets/**` 下所有资源，读取 `assets/scripts/Game.ts` 的内容。

> 用 web-mobile 平台做一次构建。

## 能力总览

- **场景/节点**：查询节点树、创建/删除/复制/重挂父节点、按路径或 uuid 查找、保存/打开/关闭场景。
- **预制体/组件/属性**：把节点存成预制体资源、增删组件、设置属性、执行组件方法、查询可用组件类。
- **代码执行**：在场景进程（`cc` 引擎可用）或编辑器主进程（Node + `Editor`）执行任意 JS。
- **资源**：列出/查询/创建/导入/删除/读写资源文件、uuid↔url↔路径互转、把文件夹设为/取消资源 Bundle。
- **构建/预览**：无头命令行构建、打开构建面板、打开/刷新预览。
- **选择**：选中/清除节点或资源。

完整工具清单见 [docs/tools.md](docs/tools.md)，架构与协议见 [docs/architecture.md](docs/architecture.md)。

## 安全提示

- 扩展仅监听 `127.0.0.1`（本机回环），不对外网暴露。
- `scene_eval` / `editor_eval` 可执行任意代码，能力强大，请只在可信场景使用。
- 如需鉴权，可给两端都设置 `CC_MCP_TOKEN`（见 docs/setup.md）。
