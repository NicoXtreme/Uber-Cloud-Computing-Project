# Uber Ride-Sharing local prototype

This monorepo uses npm workspaces. Each microservice has its own package, Express entry point and build output. Service identifiers and responsibilities follow Delivery 2.

## Requirements

- Node.js 22.18 or a later Node.js 22 release, or Node.js 24 and above. Use npm 10 or above.
- Run these commands from `prototype/`.

```sh
npm ci
npm run build
npm run lint
npm test
```

`npm ci` uses the committed lockfile. `npm test` builds the workspaces, checks both health endpoints for each service over HTTP using ephemeral ports, and tests the SVC-02 request and response examples.

## Validate the API contracts

The canonical OpenAPI 3.1 contracts are in [packages/contracts/openapi/](packages/contracts/openapi/README.md). Each service has its own specification and references the shared components. The directory README documents versioning, authentication, errors, tracing, identifiers and pagination.

```sh
npm run validate:openapi
```

After installing dependencies, this command checks all eight documents, resolves their local references, and validates their JSON request and response examples against their schemas. Validation runs locally without starting the services.

## Run a service

```sh
npm run dev --workspace @uber-prototype/svc-02-ride-request
```

Development mode restarts the process when TypeScript files change. To run the compiled version, use `npm run build` and then `npm start --workspace @uber-prototype/svc-02-ride-request`. To build a single service, use `npm run build --workspace @uber-prototype/svc-02-ride-request`.

Every service exposes `GET /health/live` and `GET /health/ready`. In this scaffold both routes indicate that the HTTP process is responding. With SVC-02 running, try `http://127.0.0.1:3002/health/ready`.

The default host is `127.0.0.1`. To change the host or a port, copy `.env.example` to `.env` in this directory and edit the values. Process environment variables take precedence.

| Service | Workspace under `@uber-prototype/` | Port |
| --- | --- | ---: |
| Account and Driver Management | `svc-01-account-and-driver` | 3001 |
| Ride Request Management | `svc-02-ride-request` | 3002 |
| Matching and Dispatch | `svc-03-matching-and-dispatch` | 3003 |
| Trip Management and Tracking | `svc-04-trip-and-tracking` | 3004 |
| Pricing and Geospatial | `svc-05-pricing-and-geospatial` | 3005 |
| Payment and Settlement | `svc-06-payment-and-settlement` | 3006 |
| Feedback and Safety | `svc-07-feedback-and-safety` | 3007 |
| Notifications and Communications | `svc-08-notifications` | 3008 |

`packages/contracts` owns the shared contracts. `packages/shared` is reserved for reusable technical utilities.

## Local databases

The [local infrastructure guide](infra/local/README.md) documents the Docker Compose `minimal` and `full` profiles and their database bootstrap commands. The guide also includes standalone Docker commands for PostgreSQL with PostGIS, DynamoDB Local and Redis.

## Collaboration

1. Create a branch from the latest `main`, for example `feat/2-openapi-contracts`.
2. Open a pull request targeting `main` and include `Closes #<number>` in its description.
3. Request a teammate's review and run the relevant checks before merging.
