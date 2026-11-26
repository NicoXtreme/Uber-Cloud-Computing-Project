import { loadContract, serviceIds, validateExamples } from './openapi.mjs';

for (const serviceId of serviceIds) {
  const contract = await loadContract(serviceId);
  const count = validateExamples(contract);
  globalThis.console.log(`${serviceId}: OpenAPI document and ${count} example occurrences validated`);
}
