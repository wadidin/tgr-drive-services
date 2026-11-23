import { env } from './config/env.js';
import { buildServer } from './app.js';

const app = await buildServer();
app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
