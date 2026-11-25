import express from 'express';

export const app = express();
const health = { service: 'svc-07', status: 'ok' };

app.get(['/health/live', '/health/ready'], (_request, response) => {
  response.json(health);
});
