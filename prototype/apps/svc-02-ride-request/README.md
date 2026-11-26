# SVC-02 ride request persistence

The domain model owns a ride request, its rider identifier, pickup and destination, tier, quote snapshot, status and timestamps. The public representation stays defined by the [SVC-02 OpenAPI contract](../../packages/contracts/openapi/svc-02.yaml). The rider identifier and revision are internal attributes.

- A new request starts in `pending_confirmation`. It can move to `searching` with the current unexpired quote, to `cancelled`, or to `expired` when the quote expires.
- A searching request can move to `matched`, `no_driver_found`, or `cancelled`. Matching ends the request lifecycle. SVC-04 owns the subsequent trip lifecycle. A trip identifier is optional at hand-off.
- The repository uses the existing `svc-02-ride-requests` table with string key `request_id`. Reads are strongly consistent. Creation is conditional on the key being absent. Transitions require the revision observed by the caller and use an atomic check of both revision and previous status.
- Reads of missing requests return `null`. The repository distinguishes duplicate creation, missing transition targets, conflicts and storage failures. After an ambiguous write failure, read the stored state before choosing whether to retry.

## Local configuration and tests

The endpoint defaults to `http://127.0.0.1:8000`. Set `SVC_02_DYNAMODB_ENDPOINT` in `prototype/.env` or the environment to use another local port. The client also accepts `localhost`, `[::1]`, `d4-dynamodb` and `dynamodb-local` as local hosts. It uses fixed dummy credentials and bounded network timeouts.

Start DynamoDB Local as shown in the [local database guide](../../infra/local/README.md). From `prototype/`, run:

```sh
npm run db:init -- dynamodb
npm run db:verify -- dynamodb
npm test
npm run test:integration --workspace @uber-prototype/svc-02-ride-request
```

The regular tests cover domain rules and transport failures using a loopback socket. The integration tests create unique records and remove them when each test completes. One case writes a record from a SVC-02 process that exits and reads it from a new process. Another holds both concurrent writes until both callers have loaded the same revision, then checks that DynamoDB accepts exactly one write.
