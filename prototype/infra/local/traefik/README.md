# Local API gateway

Traefik is available in the `minimal` and `full` Compose profiles. Run from `prototype/`.

```sh
docker compose --profile minimal up --build -d --wait
node --env-file-if-exists=.env --test infra/local/traefik/smoke.mjs
docker compose --profile minimal ps
```

Use `http://127.0.0.1:8080` by default. `LOCAL_GATEWAY_PORT` controls the host port and leaves the container listener fixed at 8080. Compose overrides the SVC-02 listen address to `0.0.0.0`, uses internal port 3002, and points DynamoDB traffic at `http://dynamodb-local:8000`. Host-run services use their existing environment settings.

## Public route convention

| Method | Path | Service |
| --- | --- | --- |
| POST | `/v1/ride-requests` | SVC-02 |
| GET | `/v1/ride-requests/{id}` | SVC-02 |
| POST | `/v1/ride-requests/{id}/confirm` | SVC-02 |
| POST | `/v1/ride-requests/{id}/cancel` | SVC-02 |

Register each additional public operation as an explicit method and path matcher from its OpenAPI contract. Use anchored matchers for dynamic path segments, and preserve the full versioned path the service expects. Avoid a catch-all `/v1` router and overlapping method/path rules, especially on shared prefixes such as `/v1/users` and `/v1/trips`. Service-only operations such as driver eligibility, OTP delivery and final fare calculation belong on private service connections. Administrative, agent and unregistered operations have no router here. Unmatched requests receive Traefik's `404`.

## Local trust boundary

The file provider contains the allowlist. The gateway publishes one loopback port. Traefik shares a dedicated edge network with SVC-02, and SVC-02 also joins the existing backend network. Service health is checked internally and the Traefik health listener stays on container loopback. The administrative API and dashboard are disabled.

Traefik passes `X-Correlation-ID` through. SVC-02 validates it or assigns one when absent, and generates its own request ID. The gateway discards the configured client identity headers and leaves Bearer verification to the service. SVC-02 returns `401` until a trusted verifier is wired in. The smoke test deliberately exercises that behavior. This stack uses plain local HTTP.

The SVC-02 build is a small workspace-only development image used to verify gateway routing. The service packaging and broader service verification remain in issue #12. Queue topology, workers and other services are outside this setup.
