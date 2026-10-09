// Isolated fixture ports and a shared WebKit connection for ab-suites. Standalone suites retain one headless browser.
import net from 'node:net';
import { webkit as engine } from 'playwright';
export const webkit = {
  launch: options => process.env.AB_WEBKIT_ENDPOINT ? engine.connect(process.env.AB_WEBKIT_ENDPOINT) : engine.launch(options),
};
export async function suitePort() {
  if (process.env.AB_PORT) {
    const port = Number(process.env.AB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid AB_PORT');
    return port;
  }
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
// Only the runner starts this mode, and closes its stdin at the end (or kills its process group on timeout).
if (process.argv[2] === '--browser-server') {
  const server = await engine.launchServer({ headless: true });
  console.log(server.wsEndpoint());
  process.stdin.resume();
  const close = async () => { await server.close(); process.exit(0); };
  process.stdin.on('end', close);
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}
