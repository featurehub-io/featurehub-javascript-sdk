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

## API keys

- **Client-evaluated keys** (contain a `*`): the bundle — including rollout strategies — is delivered to the provider and every evaluation runs locally against the supplied context. Use this for services handling many different users; contexts are evaluated per call with no shared state.
- **Server-evaluated keys** (`default/...`): the provider holds a single shared context for its lifetime and re-fetches the evaluated bundle only when that context changes (the SDK pools refreshes and honours `ETag`/`304`). Resolutions are serialised through a mutex, so use client-evaluated keys for concurrent multi-user workloads.

Resolutions report `TARGETING_MATCH` with the matched strategy id as `variant`, `DEFAULT` for value-less features, and standard OpenFeature error codes (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, `PARSE_ERROR`, `INVALID_CONTEXT`, `PROVIDER_NOT_READY`).

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

`PROVIDER_READY`, `PROVIDER_ERROR` and `PROVIDER_CONFIGURATION_CHANGED` (with the keys whose versions actually changed) are emitted from the SDK's repository listeners.

## License

MIT
