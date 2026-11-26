# SVC-08 notification persistence

SVC-08 owns message logs and user preferences. Every repository operation requires a recipient access context. The caller must construct that context from verified identity or a trusted internal operation, never from an unverified user input. The repository derives ownership from the context, scopes history queries to that recipient, and treats a foreign message ID as missing.

## Models and storage

- A message has a resource ID, recipient, notification type, email/SMS/push channel, template reference, correlation ID, status, timestamps, attempt count and revision. It starts as pending. `recordResult` conditionally records its first outcome as delivered or failed, with the attempt time. Store a template ID only. Rendered content, OTPs, provider tokens and provider payloads are outside the model.
- Preferences store the three channel flags separately from logs. When a record is absent, all three channels default to disabled. This default is returned without creating an item. A replacement requires the expected revision, or `null` for the initial write.

Both repositories use `svc-08-notifications`, preserving its `notification_id` partition key. Message records use their original resource IDs. Preferences use `preferences#<user-id>`, a prefix unavailable to message IDs. Only message records have the sparse `recipient-history` index attributes. The bootstrap adds that index in place on `recipient_id` and `history_key`. Items without those attributes remain outside history.

History uses DynamoDB Query by recipient, with newest creation time first and notification ID as a stable tie-breaker. It accepts 1–100 items per page, defaulting to 20, and returns an opaque continuation cursor scoped to the recipient. A cursor is a pagination hint and conveys no authorization. Index reads are eventually consistent. Direct ID and preference reads are strongly consistent. Conditional failures surface as conflicts. Storage errors remain distinct from absent data.

## Local verification

Start DynamoDB Local using the [local database guide](../../infra/local/README.md). The repository client uses fixed dummy credentials and defaults to `http://127.0.0.1:8000`. Set `SVC_08_DYNAMODB_ENDPOINT` to override the local endpoint.

From `prototype/`:

```sh
npm run db:init -- dynamodb
npm run db:verify -- dynamodb
npm test
npm run test:integration --workspace @uber-prototype/svc-08-notifications
```

The integration suite uses unique recipients and message IDs and cleans up its records. It verifies persistence across process restarts, isolated reads and writes, indexed pagination, and conditional updates. Transport tests use a loopback socket.
