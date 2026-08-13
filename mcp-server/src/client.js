'use strict';

/**
 * Minimal JSON-RPC 2.0 client for the cc-mcp editor extension's HTTP endpoint.
 */

let seq = 0;

export class CocosClient {
  constructor(baseUrl, token) {
    this.baseUrl = (baseUrl || process.env.CC_MCP_URL || 'http://127.0.0.1:32123').replace(/\/+$/, '');
    this.token = token || process.env.CC_MCP_TOKEN || null;
  }

  async call(method, params) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    let res;
    try {
      res = await fetch(this.baseUrl + '/rpc', {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params: params || {} }),
      });
    } catch (e) {
      throw new Error(
        'Cannot reach the Cocos Creator cc-mcp extension at ' + this.baseUrl +
        '. Make sure Cocos Creator is open, the project has the cc-mcp extension installed, ' +
        'and the editor has been reloaded. (' + e.message + ')'
      );
    }

    let json;
    try {
      json = await res.json();
    } catch (_e) {
      throw new Error('cc-mcp returned a non-JSON response (HTTP ' + res.status + ')');
    }

    if (json && json.error) {
      const data = json.error.data ? ' :: ' + JSON.stringify(json.error.data) : '';
      throw new Error('cc-mcp error [' + method + ']: ' + json.error.message + data);
    }
    return json && json.result;
  }

  async health() {
    const res = await fetch(this.baseUrl + '/health');
    return res.json();
  }
}
