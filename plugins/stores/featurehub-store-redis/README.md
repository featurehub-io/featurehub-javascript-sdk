# featurehub-store-redis

Redis-backed feature state store for the [FeatureHub](https://featurehub.io) JavaScript SDK.

In a multi-instance Node.js deployment (containers, serverless, horizontally-scaled services)
each process normally maintains its own in-memory feature state, populated independently from
FeatureHub. This plugin bridges that gap: every instance shares a single Redis-cached copy of
the feature state, so that updates from FeatureHub are visible across all processes shortly
after they arrive on any one of them, without every instance needing its own persistent
connection to FeatureHub. Also, if a connection temporarily fails to FeatureHub, as long as Redis is available
then updates will keep arriving.

**Node.js only.** Requires Node.js ≥ 20.

---

## How it works

The store registers itself as a `RawUpdateFeatureListener` on the FeatureHub repository. Whenever
the repository receives a feature update from FeatureHub (via SSE streaming or polling), the store
writes the updated state to Redis. On startup it reads whatever is already in Redis and loads it
into the repository immediately, so the first request can be served without waiting for FeatureHub
to push an update.

A periodic refresh timer (default every 5 minutes) compares the SHA-256 fingerprint stored in
Redis against the last-known fingerprint. If they differ, another instance has written newer
state and the local repository is reloaded from Redis.

### Optimistic locking

For single-node Redis (`RedisSessionStoreUrl` and `RedisSessionStoreClient`), writes use
`WATCH` / `MULTI` / `EXEC` to prevent lost updates when multiple instances write concurrently.
If the `WATCH` is invalidated by a competing write, the store backs off and retries (up to 10
times by default). Before each retry it re-reads Redis and merges by keeping the higher-versioned
copy of each feature, so no update from any instance is silently dropped.

For Redis Cluster (`RedisSessionStoreCluster`), `WATCH` and transactions are not available
across cluster slots, so the store falls back to sequential `SET` calls without optimistic
locking.

### Server-evaluated keys

The store refuses to initialise when the FeatureHub config uses **server-evaluated** API keys
(keys without a `*`). Because server-evaluated feature state is computed per-context on the
FeatureHub server, caching it in a shared store would cause one user's evaluated flags to
bleed into another user's request. Only **client-evaluated** keys (containing `*`) are safe
to share this way.

### Redis key layout

Two keys are written per environment:

| Key | Contents |
|-----|----------|
| `{prefix}_{environmentId}` | JSON array of `FeatureState` objects |
| `{prefix}_{environmentId}_sha` | SHA-256 fingerprint of the above (used for change detection) |

The default prefix is `featurehub`.

---

## Installation

```bash
npm install featurehub-store-redis
# or
pnpm add featurehub-store-redis
```

The `redis` package (v5) and `featurehub-javascript-core-sdk` are peer dependencies.

---

## Usage

### Connect via URL

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-node-sdk';
import { RedisSessionStoreUrl } from 'featurehub-store-redis';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

const store = new RedisSessionStoreUrl('redis://localhost:6379', fhConfig);
await store.init();

await fhConfig.init();
```

### Connect via client options (TLS, auth, etc.)

```typescript
import { RedisSessionStoreClient } from 'featurehub-store-redis';

const store = new RedisSessionStoreClient(
  {
    socket: { host: 'redis.internal', port: 6380, tls: true },
    password: process.env.REDIS_PASSWORD,
  },
  fhConfig,
);
await store.init();
```

### Connect to a Redis Cluster

```typescript
import { RedisSessionStoreCluster } from 'featurehub-store-redis';

const store = new RedisSessionStoreCluster(
  {
    rootNodes: [
      { host: 'redis-node-1', port: 6379 },
      { host: 'redis-node-2', port: 6379 },
    ],
  },
  fhConfig,
);
await store.init();
```

Call `store.close()` during graceful shutdown to stop the refresh timer and deregister the
listener.

---

## Options

All three classes accept an optional `RedisSessionStoreOptions` object as their last argument.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `"featurehub"` | Prefix for all Redis keys written by this store. Change this if multiple environments or applications share the same Redis instance. |
| `backoff_timeout` | `number` | `500` | Milliseconds to wait between write retries when a `WATCH` conflict is detected (single-node only). |
| `retry_update_count` | `number` | `10` | Maximum number of write attempts before giving up on a conflicted write. |
| `refresh_timeout` | `number` | `300` | How often (in seconds) the store polls Redis for changes made by other instances. |

```typescript
const store = new RedisSessionStoreUrl('redis://localhost:6379', fhConfig, {
  prefix: 'myapp',
  refresh_timeout: 60,   // check for external changes every minute
  backoff_timeout: 200,  // faster retry on conflict
});
```

---

## Lifecycle

```
new RedisSessionStoreUrl(url, fhConfig, options)
        │
        ▼
await store.init()   ← connects to Redis, loads cached state into repository,
        │              starts periodic refresh timer
        │
  [application runs]
        │
store.close()        ← stops refresh timer, deregisters feature listener
```

`store.connected` returns `true` while the store is initialised and the Redis client reports
the connection as open.

---

## License

MIT
