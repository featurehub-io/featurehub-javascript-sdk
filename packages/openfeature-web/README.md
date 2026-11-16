# FeatureHub OpenFeature Provider — Web

Official [OpenFeature](https://openfeature.dev) provider for [FeatureHub](https://featurehub.io), for browsers.

FeatureHub always evaluates features against a **local copy of the features**: the full feature bundle (including rollout strategies) is fetched from Edge and cached, and every OpenFeature resolution is evaluated in-memory. The browser never asks the server per evaluation — it only contacts Edge to fetch or refresh the bundle (on the update interval, or in passive mode when a resolution happens after the cached bundle has expired). There is no concept of a price per evaluation.

## Install

```sh
npm install featurehub-openfeature-web-sdk @openfeature/web-sdk
```

## Usage

Set the evaluation context **before** registering the provider. If the context is set (or changed) after the provider is registered, the feature bundle is requested from the server again for the changed context — with the same context on every request, as is normal in a web app, you want the bundle fetched once:

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

The provider keeps a single evaluation context: it is created in `initialize`, rebuilt on `onContextChange`, and reused across resolutions. Context changes are applied locally — the bundle is only re-fetched if the FeatureHub SDK detects the context header changed and decides to re-poll.

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

## Events

`PROVIDER_READY`, `PROVIDER_ERROR` and `PROVIDER_CONFIGURATION_CHANGED` (with the keys whose versions actually changed) are emitted from the SDK's repository listeners.

## License

MIT
