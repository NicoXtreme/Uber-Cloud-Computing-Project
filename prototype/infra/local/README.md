# Local database bootstrap

## Docker Compose profiles

Run these commands from `prototype/` with a Linux Docker engine and Docker Compose v2. Copy `.env.example` to the ignored `.env` to override the local ports and passwords. Compose loads `.env` from this directory. Use nonempty, disposable local passwords. The checked-in configuration uses the same local defaults as the database scripts.

| Profile | Services |
| --- | --- |
| `minimal` | Traefik, SVC-02, DynamoDB Local, and ElasticMQ |
| `full` | The minimal profile plus PostgreSQL 17 with PostGIS 3.5 and Redis |

```sh
docker compose --profile minimal config -q
docker compose --profile full config -q

docker compose --profile minimal up --build -d --wait
npm run db:init -- compose dynamodb
npm run db:verify -- compose dynamodb

docker compose --profile full up --build -d --wait
npm run db:init -- compose
npm run db:verify -- compose

docker compose --profile full ps
docker compose --profile full logs --tail 100
docker compose --profile full stop
```

`--wait` waits for the selected containers to pass their health checks. PostgreSQL uses a TCP readiness check, DynamoDB Local runs a signed local `ListTables` request with dummy credentials, Redis checks an authenticated `PING`, and ElasticMQ runs a read-only `ListQueues` request. The `compose` argument resolves running Compose service IDs and reuses the existing SQL and DynamoDB bootstrap. Without it, the database commands use the standalone container names documented below. If you select a separate Compose project, set `COMPOSE_PROJECT_NAME` in the same shell before running both Compose and the database commands.

Host ports are bound to loopback. On the shared Docker network, use `postgres:5432`, `http://dynamodb-local:8000`, `redis:6379`, and `SQS_ENDPOINT=http://elasticmq:9324`. For clients on the host, use `127.0.0.1` and the published ports. Update the corresponding client endpoint if you override a published port. The app-level `HOST` controls the application's listen address. Use `0.0.0.0` for a future containerized app that must accept traffic from other containers.

PostgreSQL and DynamoDB use named volumes. Both `docker compose --profile full stop` and `docker compose --profile full down` preserve those named volumes. On startup, PostgreSQL uses `POSTGRES_PASSWORD` when initializing an empty data directory. Reuse its existing administrator password when attaching an existing volume. Redis holds transient driver availability and clears it on container recreation. The ElasticMQ container runs the upstream default configuration, which advertises `localhost` in generated queue URLs. Queue definitions, dead-letter queues, routing, the advertised address for Docker clients, and queue persistence are handled separately.

For a disposable test project, select a unique project name before startup. After confirming that the identified containers and volumes contain only disposable test data, explicitly remove that project's volumes with:

```sh
docker compose -p d4-disposable-test --profile full down --volumes
```

The [gateway guide](traefik/README.md) documents the public SVC-02 routes and routing checks. The full client-to-worker demonstration also requires trusted authentication, the queue topology, and a worker.

## Standalone containers

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

The SVC-08 table has a sparse `recipient-history` global secondary index on `recipient_id` and `history_key` (strings). Initialization adds the index to existing tables in place. Preference records have a distinct key prefix and no index attributes, so recipient history contains only message records.

The AWS CLI runs in a disposable container sharing DynamoDB Local's network namespace. It calls only `http://127.0.0.1:8000` within that namespace with fixed dummy credentials and no host AWS credential mounts. DynamoDB Local does not enforce service-specific IAM, so table ownership here is a development convention.

### Redis

SVC-03 owns the `svc03:` namespace. Use `svc03:driver:<driverId>:availability` for a driver session with a TTL and `svc03:geo:<marketId>` for a market GEO index. When consuming GEO results, check session availability because expiration of a session key does not remove its GEO member. Future matching logic owns updates and cleanup of the index.

The smoke check authenticates, sends `PING`, then writes, reads and removes a unique key under `svc03:bootstrap:smoke:`. A short TTL bounds its lifetime if verification is interrupted. There is no persistent fixture data to import.
