# HTTP API conventions

The eight OpenAPI 3.1 descriptions here are the canonical initial HTTP contracts. They follow the service catalog in Delivery 2, sections 4.1–4.8. Shared components live in [common.yaml](common.yaml). The local service origins in the descriptions are for direct development. Gateway routing is tracked separately.

## Versioning and compatibility

Business routes start with `/v1`. Operational health endpoints are unversioned. Use UTF-8 JSON for request and response bodies unless an operation defines a different media type. Keep compatible changes within `/v1`, such as adding an optional request field or adding response fields that consumers can ignore. Removing or renaming fields, requiring new inputs, changing their types or meaning, and changing defined error or enum semantics require a compatibility review. Introduce a new major path version for breaking changes and document migration and retirement.

## Authentication and authorization

Protected operations use `Authorization: Bearer <jwt>`. The gateway validates access tokens, and services enforce roles, audience and resource ownership. Public registration and token operations declare their own security requirements. Internal operations require a service JWT and are reserved for service-to-service calls. Role-restricted operations identify the required role with `x-access`. The payment webhook authenticates using the provider signature. For resources with private ownership, an operation can return `404` to avoid revealing whether the resource exists, as SVC-02 does for lookup.

## Status codes and errors

| Status | Meaning |
| --- | --- |
| `200` | The operation succeeded and returned a representation. |
| `201` | A resource was created. Use `Location` when the API exposes its canonical lookup URI. |
| `204` | The operation succeeded and has no response body. |
| `400` | The request is malformed or a path, query or header parameter is invalid. |
| `401` | Authentication failed. Bearer challenges include `WWW-Authenticate`. |
| `403` | The caller lacks permission or a provider signature was rejected. |
| `404` | The resource was not found or its existence is private. |
| `409` | The request conflicts with current state, such as a changed quote or reuse of an idempotency key with different input. |
| `422` | The JSON body was parsed but failed validation. |
| `429` | The request was rate limited. Include `Retry-After` when known. |
| `500` | An unexpected service error occurred. |
| `503` | A required service is temporarily unavailable. Include `Retry-After` when known. |

Errors use an `error` object with `status`, `code`, `message`, `requestId` and `correlationId`. Clients branch on the status or stable code. Messages should be safe to display and omit secrets and internal exception details. Validation errors include a nonempty `details` array with a location, a field path, a code and a message. Body field paths are JSON Pointers, for example `/pickup/latitude`. For path, query or header issues use the parameter name.

## Request tracing and identifiers

Clients may send `X-Correlation-ID` to link calls across one workflow. The gateway or receiving service generates a correlation ID when none is supplied and forwards it to downstream calls. Every HTTP attempt receives its own server-generated `X-Request-ID`. Responses return both IDs, and an error body repeats their header values. Neither ID conveys authentication or ownership.

Resource identifiers are opaque, case-sensitive strings of up to 128 ASCII letters, digits, underscores or hyphens. Consumers should preserve them exactly. Represent currency as integer minor units paired with an uppercase ISO 4217 currency code. Use ISO 8601 timestamps with a timezone.

## Pagination and retries

Paginated operations accept an optional `limit` from 1 to 100 with a default of 20, and the opaque `cursor` returned by the preceding page. Responses include `items` and `page.nextCursor`. A null cursor indicates the last page. Clients keep the same filters and ordering when following a cursor.

Operations that require an `Idempotency-Key` replay the previously accepted result for the same caller, operation and payload. A different payload under the same key returns `409`. SVC-02 requires the key on confirmation. If a quote changes, retrieve the current quote and use a new key when confirming it.

SVC-04 preserves the trip stream route under `x-websocket-endpoints`. The extension identifies the route while its WebSocket message contract remains open.
