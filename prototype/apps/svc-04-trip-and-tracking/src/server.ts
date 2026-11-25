import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_04_PORT ?? 3004);

app.listen(port, host, () => {
  console.info(`SVC-04 listening on ${host}:${port}`);
});
