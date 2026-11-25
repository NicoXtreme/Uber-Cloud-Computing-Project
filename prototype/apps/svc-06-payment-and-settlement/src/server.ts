import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_06_PORT ?? 3006);

app.listen(port, host, () => {
  console.info(`SVC-06 listening on ${host}:${port}`);
});
