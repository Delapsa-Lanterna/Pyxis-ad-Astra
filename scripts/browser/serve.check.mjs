import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serve } from './serve.mjs';

/** @type {Array<[string, number, string]>} */
const cases = [
  ['/package.json', 200, '/'],
  ['/missing-fixture.json', 404, '/'],
  ['/%2e%2e%2fpackage.json', 403, '/'],
  ['/%ZZ', 400, '/'],
  ['/preview/%ZZ', 400, '/preview/'],
  ['/package.json', 404, '/preview/'],
];
for (const [url, status, base] of cases) {
  test(`static preview completes ${url} with ${status} under ${base}`, async (context) => {
    const createServer = http.createServer;
    /** @type {import('node:http').Server[]} */
    const servers = [];
    context.mock.method(
      http,
      'createServer',
      /** @param {Parameters<typeof createServer>} args */ (...args) => {
        const server = createServer(...args);
        servers.push(server);
        context.mock.method(
          server,
          'listen',
          /** @param {Parameters<typeof server.listen>} parameters */ (...parameters) => {
            /** @type {() => void} */ (parameters.at(-1))();
            return server;
          },
        );
        context.mock.method(server, 'address', () => ({ address: '127.0.0.1', family: 'IPv4', port: 1420 }));
        return server;
      },
    );
    syncBuiltinESMExports();
    try {
      await serve({ production: true, rebuild: false, directory: '.', base });
      const server = servers[0];
      assert.ok(server);
      /** @type {(body: string | Buffer | undefined) => void} */
      let finish;
      const completed = new Promise((resolve) => {
        finish = resolve;
      });
      const headers = new Map();
      const response = {
        status: 200,
        /** @param {number} value */
        writeHead(value) {
          this.status = value;
          return this;
        },
        /** @param {string} name @param {string} value */
        setHeader(name, value) {
          headers.set(name, value);
        },
        /** @param {string | Buffer} [body] */
        end(body) {
          finish(body);
        },
      };
      server.emit('request', { url }, response);
      const body = await completed;
      assert.equal(response.status, status);
      if (status === 200) {
        assert.deepEqual(body, await readFile('package.json'));
        assert.equal(headers.get('Content-Type'), 'application/json');
      }
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}
