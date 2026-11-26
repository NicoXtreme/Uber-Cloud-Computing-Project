# Local database bootstrap

Run these commands from `prototype/` with the repository's Node.js version and a local Docker engine running Linux containers. Use disposable containers or a dedicated development database. Ports in the examples are published on loopback.

## Start the databases

```sh
docker run --rm -d --name d4-postgres -e POSTGRES_PASSWORD=local-postgres-only -p 127.0.0.1:5432:5432 postgis/postgis:17-3.5
docker run --rm -d --name d4-dynamodb -p 127.0.0.1:8000:8000 amazon/dynamodb-local:2.6.1 -jar DynamoDBLocal.jar -sharedDb -dbPath .
docker run --rm -d --name d4-redis -p 127.0.0.1:6379:6379 --mount "type=bind,source=$PWD/infra/local/redis/redis.conf,target=/usr/local/etc/redis/local.conf,readonly" redis:7.4-alpine redis-server /usr/local/etc/redis/local.conf --requirepass local-redis-only
```

The DynamoDB file is shared by local callers and resides in the disposable container. PostgreSQL data also belongs to the disposable container setup. Stopping these example containers discards their data. Redis is configured for transient availability data with snapshots and append-only persistence disabled. For disposable tests that already have those ports occupied, use `127.0.0.1::5432`, `127.0.0.1::8000` or `127.0.0.1::6379` and inspect the assigned port with `docker port <container>`.

## Initialize and verify

```sh
npm run db:init
npm run db:verify
npm run db:init
npm run db:verify
```

Pass `-- postgres`, `-- dynamodb` or `-- redis` to run either command for one database. The scripts connect inside the containers and therefore work with either default or ephemeral host ports. Stop the example containers with `docker stop d4-postgres d4-dynamodb d4-redis` when their data is disposable.

The scripts read the `LOCAL_*` settings listed in [`.env.example`](../../.env.example). Copy it to `.env` to override container names or disposable passwords. When changing the PostgreSQL administrator or Redis password, use the same value in the run command for a fresh container. Service credentials are set by the PostgreSQL bootstrap. Re-running the bootstrap applies the configured service passwords. Keep these credentials local.

### PostgreSQL and PostGIS

| Owner | Database and login | Responsibility |
| --- | --- | --- |
| SVC-01 | `svc_01` | Account and driver data |
| SVC-05 | `svc_05` | Pricing and geospatial data with PostGIS |
| SVC-06 | `svc_06` | Payments and settlement data |

The SQL creates each service database and a separate nonadministrator owner role. It revokes default public access to these databases and installs PostGIS in the SVC-05 service database. Verification connects with each service login over TCP, checks ownership and cross-service connection privileges, checks extension placement in the service databases, and runs a spatial query as SVC-05. The spatial query uses an inline sample point. The bootstrap leaves service schemas empty for their own migrations.

### DynamoDB Local

| Owner | Table | Partition key | Sort key |
| --- | --- | --- | --- |
| SVC-02 | `svc-02-ride-requests` | `request_id` (string) | |
| SVC-04 | `svc-04-trips` | `trip_id` (string) | |
| SVC-04 | `svc-04-trip-telemetry` | `trip_id` (string) | `timestamp` (epoch milliseconds, number) |
| SVC-07 | `svc-07-feedback-safety` | `record_id` (string) | |
| SVC-08 | `svc-08-notifications` | `notification_id` (string) | |

Map the opaque API resource IDs to their corresponding storage keys. SVC-07 can namespace record types with `rating#`, `incident#` and `ticket#`. SVC-04 separates trip state from append-oriented telemetry and uses the composite telemetry key described in Delivery 3. The bootstrap creates absent tables and verifies the status, key names and key types of existing tables. Existing data is retained and an incompatible key schema fails verification.

The AWS CLI runs in a disposable container sharing DynamoDB Local's network namespace. It calls only `http://127.0.0.1:8000` within that namespace with fixed dummy credentials and no host AWS credential mounts. DynamoDB Local does not enforce service-specific IAM, so table ownership here is a development convention.

### Redis

SVC-03 owns the `svc03:` namespace. Use `svc03:driver:<driverId>:availability` for a driver session with a TTL and `svc03:geo:<marketId>` for a market GEO index. When consuming GEO results, check session availability because expiration of a session key does not remove its GEO member. Future matching logic owns updates and cleanup of the index.

The smoke check authenticates, sends `PING`, then writes, reads and removes a unique key under `svc03:bootstrap:smoke:`. A short TTL bounds its lifetime if verification is interrupted. There is no persistent fixture data to import.
