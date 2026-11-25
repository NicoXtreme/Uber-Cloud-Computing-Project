import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.SVC_08_PORT ?? 3008);

app.listen(port, host, () => {
  console.info(`SVC-08 listening on ${host}:${port}`);
});
