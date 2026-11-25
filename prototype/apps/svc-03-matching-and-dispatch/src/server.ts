import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_03_PORT ?? 3003);

app.listen(port, host, () => {
  console.info(`SVC-03 listening on ${host}:${port}`);
});
