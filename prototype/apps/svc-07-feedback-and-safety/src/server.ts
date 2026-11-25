import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_07_PORT ?? 3007);

app.listen(port, host, () => {
  console.info(`SVC-07 listening on ${host}:${port}`);
});
