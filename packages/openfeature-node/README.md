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

## Migrating from the FeatureHub Node SDK

The provider is built on `featurehub-javascript-node-sdk`, so your features, API keys and rollout strategies carry over unchanged: only the code that reads them changes, from the SDK's API to OpenFeature's. Each feature is evaluated exactly as before.

### Setting up

Before:

```ts
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";

const fhConfig = new EdgeFeatureHubConfig(process.env.FEATUREHUB_EDGE_URL, process.env.FEATUREHUB_CLIENT_API_KEY);
fhConfig.streaming();
await fhConfig.init().waitForReady();
```

After:

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { FeatureHubProvider } from "featurehub-openfeature-node-sdk";

await OpenFeature.setProviderAndWait(
  new FeatureHubProvider({
    host: process.env.FEATUREHUB_EDGE_URL!,
    apiKey: process.env.FEATUREHUB_CLIENT_API_KEY!,
  }),
);
const client = OpenFeature.getClient();
```

| FeatureHub SDK | Provider |
| --- | --- |
| `new EdgeFeatureHubConfig(url, apiKey)` | `new FeatureHubProvider({ host, apiKey })`; both are required, as the provider does not read them from the environment |
| `fhConfig.streaming()` | `transport: "streaming"` (the default) |
| `fhConfig.restActive(30000)` | `pollIntervalMs: 30000` |
| `fhConfig.restPassive(30000)` | `cacheTimeToLiveMs: 30000` |
| `FEATUREHUB_CONNECT_TYPE`, `FEATUREHUB_CONNECT_INTERVAL` | Not read: choose the transport and interval in code. The other `FEATUREHUB_` variables (timeouts, streaming retry delays) still apply. |
| `await fhConfig.init().waitForReady()` | `await OpenFeature.setProviderAndWait(provider)`; `waitForReadyMs` sets how long it waits |
| `fhConfig.close()` | `await OpenFeature.close()` |

### Contexts and reading features

The SDK builds a context and reads features from it. OpenFeature passes the context with each evaluation, and always returns the default you give when a feature is missing or has no value, where the SDK returns `undefined`.

Before:

```ts
const ctx = await fhConfig
  .newContext()
  .userKey("user-123")
  .country(StrategyAttributeCountryName.NewZealand)
  .attributeValue("plan", "enterprise")
  .build();

if (ctx.isEnabled("checkout-v2")) {
  const banner = ctx.getString("banner-text") ?? "Welcome";
}
```

After:

```ts
const context = { targetingKey: "user-123", country: "new_zealand", plan: "enterprise" };

if (await client.getBooleanValue("checkout-v2", false, context)) {
  const banner = await client.getStringValue("banner-text", "Welcome", context);
}
```

| FeatureHub SDK | OpenFeature |
| --- | --- |
| `.userKey("user-123")` | `targetingKey: "user-123"` |
| `.sessionKey(id)` | `session: id` |
| `.country(...)`, `.device(...)`, `.platform(...)`, `.version(...)` | `country`, `device`, `platform`, `version`, as the enum's string value (`StrategyAttributeCountryName.NewZealand` is `"new_zealand"`) |
| `.attributeValue("plan", "enterprise")` | `plan: "enterprise"`; a list of strings, numbers, booleans or dates is fine, a nested object is `INVALID_CONTEXT`. Keys other than the well-known ones keep their case, and `fhubWhenActive` is ignored, as only a strategy may set it |
| a `Date` attribute value | the same `Date` (or a list of them); it is evaluated, and sent to FeatureHub, as UTC to the second |
| `ctx.isEnabled(key)`, `ctx.getFlag(key)`, `ctx.getBoolean(key)` | `client.getBooleanValue(key, false, context)` |
| `ctx.getString(key)` | `client.getStringValue(key, default, context)` |
| `ctx.getNumber(key)` | `client.getNumberValue(key, default, context)` |
| `ctx.getJson(key)` | `client.getObjectValue(key, default, context)`; the value must be a JSON object |
| `ctx.getRawJson(key)` | no equivalent: OpenFeature only gives the parsed object |
| `ctx.isSet(key)` | `get...Details(...)`: `errorCode` is `FLAG_NOT_FOUND` if the feature does not exist; `reason` is `DISABLED` if it exists with no value |
| the strategy that matched (`feature(key).getValue().strategyId`) | `details.variant`, with `details.reason` (`SPLIT`, `TARGETING_MATCH` or `STATIC`) |
| `feature(key).featureProperties` | `details.flagMetadata`, which also holds `featureVersion` and `featureType` |
| `feature(key).locked` | no equivalent |

With a server-evaluated key the SDK fetched features for each context you built. The provider holds a single context and fetches again only when an evaluation's context differs from the last one, serialising evaluations to do it, so a client-evaluated key suits services that evaluate for many users.

### Listening for changes

| FeatureHub SDK | OpenFeature |
| --- | --- |
| `fhConfig.addReadinessListener(...)` | `client.addHandler(ProviderEvents.Ready, ...)`, and `client.providerStatus` |
| readiness `Failed` | `setProviderAndWait` rejects, and `providerStatus` is `FATAL` |
| `fhConfig.addConnectionEventListener(...)` | `client.addHandler(ProviderEvents.Stale, ...)` |
| `feature(key).addListener(...)` | `client.addHandler(ProviderEvents.ConfigurationChanged, (details) => ...)`; `details.flagsChanged` lists the keys, so read the ones you need again |

### Interceptors, stores and usage plugins

Value interceptors, feature stores and usage plugins are attached to the FeatureHub config, which the provider creates. Pass `configFactory` to create it yourself and attach them; the provider still applies its transport options to it and starts it, so do not call `init()`:

```ts
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";
import { LocalYamlValueInterceptor } from "featurehub-yaml-interceptor";
import { RedisSessionStoreUrl } from "featurehub-store-redis";
import { OpenTelemetryTrackerUsagePlugin } from "featurehub-usage-opentelemetry";

const provider = new FeatureHubProvider({
  host: process.env.FEATUREHUB_EDGE_URL!,
  apiKey: process.env.FEATUREHUB_CLIENT_API_KEY!,
  configFactory: ({ host, apiKey }) => {
    const config = new EdgeFeatureHubConfig(host, apiKey);
    config.addValueInterceptor(new LocalYamlValueInterceptor());
    config.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin());
    new RedisSessionStoreUrl("redis://localhost:6379", config);
    return config;
  },
});
```

A value an interceptor supplies as a string is converted to the type you ask for.

### What stays with the SDK

Keep using the SDK directly for anything OpenFeature has no place for: the repository itself (raw feature updates, `simpleFeatures()`), a feature's lock, raw JSON, and readiness details beyond the provider's status.

## License

MIT
