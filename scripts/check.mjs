#!/usr/bin/env node
/**
 * cocos-mcp 一键自检：检查依赖、编辑器扩展、MCP server 是否都正常。
 *
 * 用法：
 *   node scripts/check.mjs
 *
 * 环境变量（可选）：
 *   CC_MCP_URL   扩展地址（默认 http://127.0.0.1:32123）
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'mcp-server', 'src', 'index.js');
const SDK_DIR = path.join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk');
const URL = (process.env.CC_MCP_URL || 'http://127.0.0.1:32123').replace(/\/+$/, '');

let ok = true;
const pass = (m) => console.log('  \u2714 ' + m);
const fail = (m) => { console.log('  \u2718 ' + m); ok = false; };

console.log('=== cocos-mcp 自检 ===\n');

// 1. MCP 依赖
console.log('[1/4] MCP server 依赖');
if (fs.existsSync(SDK_DIR)) {
  pass('@modelcontextprotocol/sdk 已安装');
} else {
  fail('依赖缺失：请运行  cd ' + path.join(ROOT, 'mcp-server') + ' && npm install');
}

// 2. 编辑器扩展
console.log('[2/4] 编辑器扩展 (cc-mcp)');
try {
  const r = await fetch(URL + '/health');
  const j = await r.json();
  if (j && j.status === 'ok') {
    pass('扩展在线，项目=' + j.project + '，端口=' + j.rpcPort);
  } else {
    fail('扩展返回异常：' + JSON.stringify(j));
  }
} catch (_e) {
  fail('连不上 ' + URL + ' —— 确认 Cocos Creator 已打开项目且 cc-mcp 扩展已加载');
}

// 3. MCP server 握手 + 工具数
console.log('[3/4] MCP server 握手');
const toolCount = await countTools();
if (toolCount > 0) {
  pass('MCP server 正常，暴露 ' + toolCount + ' 个工具');
} else {
  fail('MCP server 握手失败');
}

// 4. 结论
console.log('\n[4/4] 结论');
if (ok) {
  console.log('  全部就绪。接下来把 MCP server 注册进 AI 客户端即可：\n');
  console.log('  node  ' + SERVER_SRC + '\n');
  console.log('  配置示例见 examples/mcp-config.json，各客户端配置见 docs/setup.md');
} else {
  console.log('  存在上述 \u2718 项，请先处理后再接入 AI 客户端。');
}
process.exit(ok ? 0 : 1);

function countTools() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER_SRC], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => finish(0), 5000);
    const finish = (n) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_e) { /* already gone */ }
      resolve(n);
    };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      for (;;) {
        const i = buf.indexOf('\n');
        if (i < 0) break;
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_e) { continue; }
        if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
          finish(msg.result.tools.length);
        }
      }
    });

    const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    child.on('error', () => finish(0));
    child.on('close', () => finish(0));
  });
}
