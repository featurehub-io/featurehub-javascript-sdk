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
    apiKey: process.env.FEATUREHUB_CLIENT_API_KEY!, // client-evaluated (`*...`) recommended for servers
  }),
);

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout-v2", false, {
  targetingKey: "user-123",
  country: "new_zealand",
});
```

With `FEATUREHUB_EDGE_URL` and `FEATUREHUB_CLIENT_API_KEY` set, `new FeatureHubProvider()` is enough: see [Environment variables](#environment-variables).

If your service evaluates with a single application-wide context, set it **before** registering the provider (via `OpenFeature.setContext`, or by passing it to `setProviderAndWait`): changing the context after registration re-requests the feature bundle for the changed context. Per-request contexts (the normal case for client-evaluated keys) are evaluated locally and are unaffected.

## API keys

- **Client-evaluated keys** (contain a `*`): the bundle — including rollout strategies — is delivered to the provider and every evaluation runs locally against the supplied context. Use this for services handling many different users; contexts are evaluated per call with no shared state.
- **Server-evaluated keys** (`default/...`): Edge evaluates the features for one context, which the provider holds for every OpenFeature client in the process, fetching them again when the context changes (honouring `ETag`/`304`). Every code path must use the same context: a resolution for a different context while another context's is in progress fails with `INVALID_CONTEXT`, rather than return the other context's values. If the features for a new context cannot be fetched, the resolution fails with `GENERAL` and the next one tries again. Use a client-evaluated key for services that evaluate for many users.

Resolutions report `SPLIT` for a percentage rollout and `TARGETING_MATCH` for any other matched strategy (including one FeatureHub applied for a server-evaluated key), each with the strategy id as `variant`; `STATIC` when no strategy applies; and `DISABLED`, with the code default, for a feature that has no value. A value supplied as a string (by a value interceptor, say) is converted to the type asked for: `"true"` and `"false"` for a boolean, a numeric string for a number. Errors use the standard OpenFeature codes (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, `PARSE_ERROR`, `INVALID_CONTEXT`, `PROVIDER_NOT_READY`, `PROVIDER_FATAL`). Flag metadata holds the feature's properties, plus `featureVersion` and `featureType`.

## Options

| Option | Description |
| --- | --- |
| `host` | FeatureHub Edge base URL. Defaults to `FEATUREHUB_EDGE_URL`. |
| `apiKey` | FeatureHub SDK API key (see above). Defaults to `FEATUREHUB_CLIENT_API_KEY`, else `FEATUREHUB_SERVER_API_KEY`. |
| `transport` | `"streaming"`, `"polling"` or `"passive"`. Without it (or the two options below), the mode comes from the environment, and is streaming if that does not say. |
| `pollIntervalMs` | REST active polling interval; implies `transport: "polling"`. |
| `cacheTimeToLiveMs` | REST passive cache TTL; implies `transport: "passive"`. |
| `waitForReadyMs` | How long `initialize` waits for readiness. Default 10s. |
| `configFactory` | Build the FeatureHub config yourself, to attach interceptors, stores and usage plugins (see below). |

### Environment variables

Anything not given in code comes from the environment, setting by setting, as for the FeatureHub Node SDK: `FEATUREHUB_EDGE_URL` for the host; `FEATUREHUB_CLIENT_API_KEY`, or else `FEATUREHUB_SERVER_API_KEY`, for the key; and, when no transport option is given, `FEATUREHUB_CONNECT_TYPE` (`active`, `passive` or `streaming`) with `FEATUREHUB_CONNECT_INTERVAL` (such as `30s`). An empty variable counts as not set. The SDK's other variables (timeouts, streaming retry delays) apply as well.

### Stores only

With no host and no key, in code or the environment, the provider runs from the features its config's stores supply, such as a local YAML file, and evaluates them locally. Give it a `configFactory` that builds the config with no connection:

```ts
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";
import { LocalYamlFeatureStore, LocalYamlValueInterceptor } from "featurehub-yaml-interceptor";

const provider = new FeatureHubProvider({
  configFactory: () => {
    const config = new EdgeFeatureHubConfig();
    new LocalYamlFeatureStore(config);
    config.addValueInterceptor(new LocalYamlValueInterceptor());
    return config;
  },
});
```

Giving only one of the host and key is an error.

## Tracking

`client.track(name, context, details)` records a FeatureHub named usage event, with the context's attributes and the details, for the usage plugins registered on the config (Segment, say; see [configFactory](#interceptors-stores-and-usage-plugins)). Without a usage plugin it goes nowhere.

```ts
client.track("checkout-complete", { targetingKey: "user-123" }, { value: 99.95, currency: "NZD" });
```

## Events

`PROVIDER_CONFIGURATION_CHANGED` is emitted with the keys of the features that changed: a new version, a feature added, or one deleted or no longer in a full set.

If the connection to FeatureHub stops for good once features have arrived (the API key is rejected, or FeatureHub says the environment is stale), the provider emits `PROVIDER_STALE`, once, and keeps resolving from the last features it received. This also happens if the connection stops with the very first response: initialisation succeeds, and `PROVIDER_STALE` follows `PROVIDER_READY`. If the connection is rejected before any features arrive, initialisation fails as `PROVIDER_FATAL`. A server-evaluated key's context change keeps resolving from the previous context's features until the new ones arrive, and emits no event.

## Migrating from the FeatureHub Node SDK

The provider is built on `featurehub-javascript-node-sdk`, so your features, API keys and rollout strategies carry over unchanged: only the code that reads them changes, from the SDK's API to OpenFeature's. Each feature is evaluated exactly as before.

### Setting up

Before:

```ts
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";

const fhConfig = new EdgeFeatureHubConfig(); // FEATUREHUB_EDGE_URL and FEATUREHUB_CLIENT_API_KEY
await fhConfig.init().waitForReady();
```

After:

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { FeatureHubProvider } from "featurehub-openfeature-node-sdk";

await OpenFeature.setProviderAndWait(new FeatureHubProvider()); // the same variables
const client = OpenFeature.getClient();
```

| FeatureHub SDK | Provider |
| --- | --- |
| `new EdgeFeatureHubConfig(url, apiKey)` | `new FeatureHubProvider({ host, apiKey })`; either may come from the environment, as for the SDK |
| `new EdgeFeatureHubConfig()` with only stores (a local YAML file, say) | `new FeatureHubProvider({ configFactory })`, the factory attaching the stores ([Stores only](#stores-only)) |
| `fhConfig.streaming()` | `transport: "streaming"` |
| `fhConfig.restActive(30000)` | `pollIntervalMs: 30000` |
| `fhConfig.restPassive(30000)` | `cacheTimeToLiveMs: 30000` |
| `FEATUREHUB_CONNECT_TYPE`, `FEATUREHUB_CONNECT_INTERVAL` | read as by the SDK, when no transport option is given |
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
| `ctx.recordNamedUsage(name, params)` | `client.track(name, context, params)` ([Tracking](#tracking)) |
| `ctx.isSet(key)` | `get...Details(...)`: `errorCode` is `FLAG_NOT_FOUND` if the feature does not exist; `reason` is `DISABLED` if it exists with no value |
| the strategy that matched (`feature(key).getValue().strategyId`) | `details.variant`, with `details.reason` (`SPLIT`, `TARGETING_MATCH` or `STATIC`) |
| `feature(key).featureProperties` | `details.flagMetadata`, which also holds `featureVersion` and `featureType` |
| `feature(key).locked` | no equivalent |

With a server-evaluated key the SDK fetched features for each context you built. The provider holds a single context, and fetches again only when an evaluation's context differs from the last one. Evaluating a different context while another context's evaluation is in progress fails with `INVALID_CONTEXT`, so a client-evaluated key suits services that evaluate for many users.

### Listening for changes

| FeatureHub SDK | OpenFeature |
| --- | --- |
| `fhConfig.addReadinessListener(...)` | `client.addHandler(ProviderEvents.Ready, ...)`, and `client.providerStatus` |
| readiness `Failed` | `setProviderAndWait` rejects, and `providerStatus` is `FATAL` |
| `fhConfig.addConnectionEventListener(...)` | `client.addHandler(ProviderEvents.Stale, ...)` |
| `feature(key).addListener(...)` | `client.addHandler(ProviderEvents.ConfigurationChanged, (details) => ...)`; `details.flagsChanged` lists the keys, so read the ones you need again |

### Interceptors, stores and usage plugins

Value interceptors, feature stores and usage plugins are attached to the FeatureHub config, which the provider creates. Pass `configFactory` to create it yourself and attach them. The provider starts it, so do not call `init()`; it applies a transport option if you give one, and otherwise leaves the config's own mode (from the environment, or one you set on it):

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
