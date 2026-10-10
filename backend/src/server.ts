import { createApp } from './app.js';
import { readConfig } from './config/env.js';

const config = readConfig();
const { app, store } = await createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(`Backend disponível em http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
