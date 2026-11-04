import { serve } from '../src/runtime.mjs';

/** @param {string} root @param {number} [port] @param {Parameters<typeof serve>[2]} [options] @param {typeof serve} [start] */
export async function serveReport(root, port = 0, options = {}, start = serve) {
  while (true) {
    const server = await start(root, port, options);
    try {
      await fetch(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`);
      return server;
    } catch (error) {
      await new Promise((done) => server.close(done));
      if (port !== 0 || !(error instanceof TypeError) || !(error.cause instanceof Error) || error.cause.message !== 'bad port') throw error;
    }
  }
}
