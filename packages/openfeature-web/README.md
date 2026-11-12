# FeatureHub OpenFeature Provider — Web

Official [OpenFeature](https://openfeature.dev) provider for [FeatureHub](https://featurehub.io), for browsers.

Every OpenFeature resolution is evaluated **synchronously** from the FeatureHub SDK's local feature repository — the full feature bundle is cached in the browser. There are **no per-flag network calls**.

## Install

```sh
npm install featurehub-openfeature-web-sdk @openfeature/web-sdk
```

## Usage

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { FeatureHubWebProvider } from "featurehub-openfeature-web-sdk";

await OpenFeature.setProviderAndWait(
  new FeatureHubWebProvider({
    host: "https://edge.featurehub.io",
    apiKey: "your-client-evaluated-key", // must contain `*`
  }),
);

const client = OpenFeature.getClient();
const enabled = client.getBooleanValue("checkout-v2", false, { targetingKey: "user-123" });
```

Only **client-evaluated** keys (containing `*`) are accepted; the constructor throws for server-evaluated keys, because the OpenFeature web paradigm resolves synchronously.

## Transport

The default transport is **REST passive**: Edge is only contacted when a resolution happens after the cached bundle has expired. That avoids a long-lived SSE connection (or constant polling) per browser tab. Opt in to the others with `transport: "streaming"` (SSE) or `pollIntervalMs`.

The provider keeps a single evaluation context: it is created in `initialize`, rebuilt on `onContextChange`, and reused across resolutions.

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
