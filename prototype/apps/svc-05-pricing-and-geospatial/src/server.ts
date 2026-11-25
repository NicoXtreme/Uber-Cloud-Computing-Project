import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_05_PORT ?? 3005);

app.listen(port, host, () => {
  console.info(`SVC-05 listening on ${host}:${port}`);
});
