# FeatureHub OpenFeature Provider — Node.js

Official [OpenFeature](https://openfeature.dev) provider for [FeatureHub](https://featurehub.io), for Node.js servers.

Every OpenFeature resolution is served from the FeatureHub SDK's **local feature repository** — the full feature bundle is streamed, polled or refreshed in the background and evaluated in-memory. There are **no per-flag network calls**.

## Install

```sh
npm install featurehub-openfeature-node-sdk @openfeature/server-sdk
```

## Usage

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { FeatureHubProvider } from "featurehub-openfeature-node-sdk";

await OpenFeature.setProviderAndWait(
  new FeatureHubProvider({
    host: "https://edge.featurehub.io",
    apiKey: process.env.FEATUREHUB_API_KEY!, // client-evaluated (`*...`) recommended for servers
  }),
);

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout-v2", false, {
  targetingKey: "user-123",
  country: "NZ",
});
```

If your service evaluates with a single application-wide context, set it **before** registering the provider (via `OpenFeature.setContext`, or by passing it to `setProviderAndWait`): changing the context after registration re-requests the feature bundle for the changed context. Per-request contexts (the normal case for client-evaluated keys) are evaluated locally and are unaffected.

## API keys

- **Client-evaluated keys** (contain a `*`): the bundle — including rollout strategies — is delivered to the provider and every evaluation runs locally against the supplied context. Use this for services handling many different users; contexts are evaluated per call with no shared state.
- **Server-evaluated keys** (`default/...`): the provider holds a single shared context for its lifetime and re-fetches the evaluated bundle only when that context changes (the SDK pools refreshes and honours `ETag`/`304`). Resolutions are serialised through a mutex, so use client-evaluated keys for concurrent multi-user workloads.

Resolutions report `SPLIT` for a percentage rollout and `TARGETING_MATCH` for any other matched strategy (including one FeatureHub applied for a server-evaluated key), each with the strategy id as `variant`; `STATIC` when no strategy applies; and `DISABLED`, with the code default, for a feature that has no value. A value supplied as a string (by a value interceptor, say) is converted to the type asked for: `"true"` and `"false"` for a boolean, a numeric string for a number. Errors use the standard OpenFeature codes (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, `PARSE_ERROR`, `INVALID_CONTEXT`, `PROVIDER_NOT_READY`, `PROVIDER_FATAL`). Flag metadata holds the feature's properties, plus `featureVersion` and `featureType`.

## Options

| Option | Description |
| --- | --- |
| `host` | FeatureHub Edge base URL. |
| `apiKey` | FeatureHub SDK API key (see above). |
| `transport` | `"streaming"` (default), `"polling"` or `"passive"`. |
| `pollIntervalMs` | REST active polling interval; implies `transport: "polling"`. |
| `cacheTimeToLiveMs` | REST passive cache TTL; implies `transport: "passive"`. |
| `waitForReadyMs` | How long `initialize` waits for readiness. Default 10s. |
| `configFactory` | Supply a pre-built config (used by tests). |

## Events

`PROVIDER_CONFIGURATION_CHANGED` is emitted with the keys of the features that changed: a new version, a feature added, or one deleted or no longer in a full set.

If the connection to FeatureHub stops for good once features have arrived (the API key is rejected, or FeatureHub says the environment is stale), the provider emits `PROVIDER_STALE`, once, and keeps resolving from the last features it received. This also happens if the connection stops with the very first response: initialisation succeeds, and `PROVIDER_STALE` follows `PROVIDER_READY`. If the connection is rejected before any features arrive, initialisation fails as `PROVIDER_FATAL`. A server-evaluated key's context change keeps resolving from the previous context's features until the new ones arrive, and emits no event.

## License

MIT
