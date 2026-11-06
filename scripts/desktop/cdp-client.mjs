/** Connects to an existing WebView target without enabling network response retention.
 * @param {string} endpoint
 */
export async function connectDesktopCdp(endpoint) {
  /** @type {{url:string,webSocketDebuggerUrl:string}[]} */
  const targets = await (await fetch(endpoint + '/json/list')).json();
  const target = targets.find((target) => target.url.startsWith('http://tauri.localhost'));
  if (!target) throw Error('Desktop WebView target is unavailable');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let sequence = 0;
  /** @type {Map<number,{resolve:(value:unknown)=>void,reject:(error:Error)=>void}>} */
  const pending = new Map();
  /** @type {Map<string,Set<(params:Record<string,unknown>)=>void>>} */
  const listeners = new Map();
  const closed = new Promise((done) => socket.addEventListener('close', () => done(undefined), { once: true }));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const work = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) work?.reject(Error(JSON.stringify(message.error)));
      else work?.resolve(message.result);
    } else for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  socket.addEventListener('close', () => {
    for (const work of pending.values()) work.reject(Error('Desktop CDP connection closed'));
    pending.clear();
  });
  await new Promise((done, reject) => {
    socket.addEventListener('open', () => done(undefined), { once: true });
    socket.addEventListener('error', () => reject(Error('Desktop CDP connection failed')), { once: true });
  });
  /** @template T @param {string} method @param {object} [params] @returns {Promise<T>} */
  function send(method, params = {}) {
    const reply = new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return /** @type {Promise<T>} */ (reply);
  }
  return {
    send,
    /** @param {string} method @param {(params:Record<string,unknown>)=>void} listener */
    on(method, listener) {
      const owned = listeners.get(method) ?? new Set();
      owned.add(listener);
      listeners.set(method, owned);
    },
    /** @template T @param {string} expression @returns {Promise<T>} */
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      const reply = /** @type {{result:{value:T},exceptionDetails?:unknown}} */ (result);
      if (reply.exceptionDetails) throw Error(JSON.stringify(reply.exceptionDetails));
      return reply.result.value;
    },
    async close() {
      socket.close();
      await closed;
    },
  };
}
