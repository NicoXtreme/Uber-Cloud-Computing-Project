import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_01_PORT ?? 3001);

app.listen(port, host, () => {
  console.info(`SVC-01 listening on ${host}:${port}`);
});
