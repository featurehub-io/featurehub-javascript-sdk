# FeatureHub OpenFeature Provider — Web

Official [OpenFeature](https://openfeature.dev) provider for [FeatureHub](https://featurehub.io), for browsers.

FeatureHub always evaluates features against a **local copy of the features**: the full feature bundle (including rollout strategies) is fetched from Edge and cached, and every OpenFeature resolution is evaluated in-memory. The browser never asks the server per evaluation — it only contacts Edge to fetch or refresh the bundle (on the update interval, or in passive mode when a resolution happens after the cached bundle has expired). There is no concept of a price per evaluation.

## Install

```sh
npm install featurehub-openfeature-web-sdk @openfeature/web-sdk
```

## Usage

Set the evaluation context before registering the provider, so the first evaluations already use it:

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { FeatureHubWebProvider } from "featurehub-openfeature-web-sdk";

// 1. Create the provider
const provider = new FeatureHubWebProvider({
  host: "https://edge.featurehub.io",
  apiKey: "your-client-evaluated-key", // must contain `*`
});

// 2. Set the evaluation context (e.g. user targeting attributes)
await OpenFeature.setContext({
  targetingKey: "user-123",
  plan: "enterprise",
});

// 3. Register the provider and wait for it to initialize
await OpenFeature.setProviderAndWait(provider);

const client = OpenFeature.getClient();
const enabled = client.getBooleanValue("checkout-v2", false);
```

Only **client-evaluated** keys (containing `*`) are accepted; the constructor throws for server-evaluated keys, because the OpenFeature web paradigm resolves synchronously.

## Transport

The default transport is **REST passive**: Edge is only contacted when a resolution happens after the cached bundle has expired. That avoids a long-lived SSE connection (or constant polling) per browser tab. Opt in to the others with `transport: "streaming"` (SSE) or `pollIntervalMs`.

The provider keeps a single evaluation context: it is created in `initialize`, rebuilt on `onContextChange`, and reused across resolutions. As the key is client-evaluated, the bundle holds every strategy, so a context change is applied locally and fetches nothing.

## Options

| Option | Description |
| --- | --- |
| `host` | FeatureHub Edge base URL. |
| `apiKey` | Client-evaluated FeatureHub SDK API key (must contain `*`). |
| `transport` | `"passive"` (default), `"streaming"` or `"polling"`. |
| `pollIntervalMs` | REST active polling interval; implies `transport: "polling"`. |
| `cacheTimeToLiveMs` | REST passive cache TTL; implies `transport: "passive"`. |
| `waitForReadyMs` | How long `initialize` waits for the first feature payload. Default 10s. |
| `configFactory` | Supply a pre-built config (used by tests). |

## Resolution

Every resolution is evaluated locally against the current context. It reports `SPLIT` for a percentage rollout and `TARGETING_MATCH` for any other matched strategy, each with the strategy id as `variant`; `STATIC` when no strategy applies; and `DISABLED`, with the code default, for a feature that has no value. A value supplied as a string (by a value interceptor, say) is converted to the type asked for: `"true"` and `"false"` for a boolean, a numeric string for a number. Errors use the standard OpenFeature codes (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, `PARSE_ERROR`, `INVALID_CONTEXT`, `PROVIDER_NOT_READY`, `PROVIDER_FATAL`). Flag metadata holds the feature's properties, plus `featureVersion` and `featureType`.

## Tracking

`client.track(name, details)` records a FeatureHub named usage event, with the current context's attributes and the details, for the usage plugins registered on the config (through `configFactory`). Without a usage plugin it goes nowhere.

## Events

`PROVIDER_CONFIGURATION_CHANGED` is emitted with the keys of the features that changed: a new version, a feature added, or one deleted or no longer in a full set.

If the connection to FeatureHub stops for good once features have arrived (the API key is rejected, or FeatureHub says the environment is stale), the provider emits `PROVIDER_STALE`, once, and keeps resolving from the last features it received. This also happens if the connection stops with the very first response: initialisation succeeds, and `PROVIDER_STALE` follows `PROVIDER_READY`. If the connection is rejected before any features arrive, initialisation fails as `PROVIDER_FATAL`.

## Migrating from the FeatureHub browser SDK

The provider is built on `featurehub-javascript-client-sdk`, so your features, API key and rollout strategies carry over unchanged: only the code that reads them changes, from the SDK's API to OpenFeature's. Each feature is evaluated locally, exactly as before.

It needs a **client-evaluated** key (containing `*`). If your app uses a server-evaluated key, keep using the SDK: OpenFeature's web paradigm resolves synchronously, which a key evaluated by FeatureHub cannot support.

### Setting up

Before:

```ts
import { EdgeFeatureHubConfig, FeatureHub } from "featurehub-javascript-client-sdk";

const fhConfig = new EdgeFeatureHubConfig("https://edge.example.com", "default/abc123/key*secret");
fhConfig.restActive(30000);
const context = await fhConfig.newContext().userKey("user-123").attributeValue("plan", "enterprise").build();
FeatureHub.set(fhConfig, context);
```

After:

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { FeatureHubWebProvider } from "featurehub-openfeature-web-sdk";

await OpenFeature.setContext({ targetingKey: "user-123", plan: "enterprise" });
await OpenFeature.setProviderAndWait(
  new FeatureHubWebProvider({
    host: "https://edge.example.com",
    apiKey: "default/abc123/key*secret",
    pollIntervalMs: 30000,
  }),
);
const client = OpenFeature.getClient();
```

| FeatureHub SDK | Provider |
| --- | --- |
| `new EdgeFeatureHubConfig(url, apiKey)` | `new FeatureHubWebProvider({ host, apiKey })` |
| `fhConfig.restActive(30000)` (the SDK's default mode) | `pollIntervalMs: 30000`. Note the provider's default is passive, not active polling |
| `fhConfig.restPassive(30000)` | `cacheTimeToLiveMs: 30000` (or `transport: "passive"`) |
| `fhConfig.streaming()` | `transport: "streaming"` |
| `await fhConfig.waitForReady()` | `await OpenFeature.setProviderAndWait(provider)`; `waitForReadyMs` sets how long it waits |
| `fhConfig.close()` | `await OpenFeature.close()` |

### Contexts and reading features

The SDK reads features from a context you build. With OpenFeature the context is set for the whole app (`OpenFeature.setContext`), and each read is synchronous. Changing the context later (a user signing in, say) is another `setContext`; as the key is client-evaluated, it is applied locally and nothing is fetched. OpenFeature always returns the default you give when a feature is missing or has no value, where the SDK returns `undefined`.

Before:

```ts
if (context.isEnabled("checkout-v2")) {
  const banner = context.getString("banner-text") ?? "Welcome";
}
```

After:

```ts
if (client.getBooleanValue("checkout-v2", false)) {
  const banner = client.getStringValue("banner-text", "Welcome");
}
```

| FeatureHub SDK | OpenFeature |
| --- | --- |
| `.userKey("user-123")` | `targetingKey: "user-123"` |
| `.sessionKey(id)` | `session: id` |
| `.country(...)`, `.device(...)`, `.platform(...)`, `.version(...)` | `country`, `device`, `platform`, `version`, as the enum's string value (`StrategyAttributeDeviceName.Browser` is `"browser"`) |
| `.attributeValue("plan", "enterprise")` | `plan: "enterprise"`; a list of strings, numbers, booleans or dates is fine, a nested object is `INVALID_CONTEXT`. Keys other than the well-known ones keep their case, and `fhubWhenActive` is ignored, as only a strategy may set it |
| a `Date` attribute value | the same `Date` (or a list of them); it is evaluated, and sent to FeatureHub, as UTC to the second |
| `context.isEnabled(key)`, `getFlag(key)`, `getBoolean(key)` | `client.getBooleanValue(key, false)` |
| `context.getString(key)` | `client.getStringValue(key, default)` |
| `context.getNumber(key)` | `client.getNumberValue(key, default)` |
| `context.getJson(key)` | `client.getObjectValue(key, default)`; the value must be a JSON object |
| `context.getRawJson(key)` | no equivalent: OpenFeature only gives the parsed object |
| `context.recordNamedUsage(name, params)` | `client.track(name, params)` ([Tracking](#tracking)) |
| `context.isSet(key)` | `get...Details(...)`: `errorCode` is `FLAG_NOT_FOUND` if the feature does not exist; `reason` is `DISABLED` if it exists with no value |
| the strategy that matched (`feature(key).getValue().strategyId`) | `details.variant`, with `details.reason` (`SPLIT`, `TARGETING_MATCH` or `STATIC`) |
| `feature(key).featureProperties` | `details.flagMetadata`, which also holds `featureVersion` and `featureType` |
| `feature(key).locked` | no equivalent |

### Listening for changes

| FeatureHub SDK | OpenFeature |
| --- | --- |
| `fhConfig.addReadinessListener(...)` | `client.addHandler(ProviderEvents.Ready, ...)`, and `client.providerStatus` |
| readiness `Failed` | `setProviderAndWait` rejects, and `providerStatus` is `FATAL` |
| `fhConfig.addConnectionEventListener(...)` | `client.addHandler(ProviderEvents.Stale, ...)` |
| `feature(key).addListener(...)` | `client.addHandler(ProviderEvents.ConfigurationChanged, (details) => ...)`; `details.flagsChanged` lists the keys, so read the ones you need again |

### Interceptors, stores and usage plugins

Value interceptors (such as the browser's session overrides), feature stores and usage plugins are attached to the FeatureHub config, which the provider creates. Pass `configFactory` to create it yourself and attach them; the provider still applies its transport options to it and starts it, so do not call `init()`:

```ts
import { EdgeFeatureHubConfig } from "featurehub-javascript-client-sdk";
import { LocalSessionStore } from "featurehub-store-localstorage";

const provider = new FeatureHubWebProvider({
  host: "https://edge.example.com",
  apiKey: "default/abc123/key*secret",
  configFactory: ({ host, apiKey }) => {
    const config = new EdgeFeatureHubConfig(host, apiKey);
    new LocalSessionStore(config); // features from the last visit are available at once
    return config;
  },
});
```

A value an interceptor supplies as a string is converted to the type you ask for.

### React

OpenFeature's React SDK (`@openfeature/react-sdk`) works with this provider, in place of `featurehub-react-sdk`.

### What stays with the SDK

Keep using the SDK directly for catch-and-release (holding feature updates back until the app chooses to show them), a server-evaluated key, the repository itself (raw feature updates, `simpleFeatures()`), a feature's lock, and raw JSON.

## License

MIT
