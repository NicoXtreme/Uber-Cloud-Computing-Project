import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_02_PORT ?? 3002);

app.listen(port, host, () => {
  console.info(`SVC-02 listening on ${host}:${port}`);
});
