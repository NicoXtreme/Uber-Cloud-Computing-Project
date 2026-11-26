import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const serviceIds = Object.freeze([
  'svc-01', 'svc-02', 'svc-03', 'svc-04',
  'svc-05', 'svc-06', 'svc-07', 'svc-08',
]);

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addFormat('password', true);

export async function loadContract(serviceId) {
  const source = new URL(`../openapi/${serviceId}.yaml`, import.meta.url);
  return SwaggerParser.validate(fileURLToPath(source), { resolve: { http: false } });
}

export function validatePayload(schema, payload) {
  const validate = ajv.compile(schema);
  return { valid: validate(payload), errors: validate.errors };
}

function validateMedia(content, context) {
  const media = content?.['application/json'];
  if (!media) return 0;

  const validate = ajv.compile(media.schema);
  const exemplars = Object.entries(media.examples ?? {});
  if ('example' in media) exemplars.push(['example', { value: media.example }]);

  for (const [name, { value }] of exemplars) {
    assert.ok(validate(value), `${context} example ${name}: ${ajv.errorsText(validate.errors)}`);
  }

  return exemplars.length;
}

export function validateExamples(contract) {
  let count = 0;
  for (const [path, operations] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation.responses) continue;
      const context = `${method.toUpperCase()} ${path}`;
      count += validateMedia(operation.requestBody?.content, `${context} request`);
      for (const [status, response] of Object.entries(operation.responses)) {
        count += validateMedia(response.content, `${context} ${status} response`);
      }
    }
  }
  return count;
}
