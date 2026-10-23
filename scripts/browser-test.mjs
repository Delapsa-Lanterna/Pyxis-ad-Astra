import { createServer } from 'vite';
import { browserTestPlugin } from './shared/browser-test.mjs';
const server = await createServer({
  plugins: [browserTestPlugin()],
  server: { host: '127.0.0.1', port: 1461, strictPort: false, open: false },
});
await server.listen();
server.printUrls();
