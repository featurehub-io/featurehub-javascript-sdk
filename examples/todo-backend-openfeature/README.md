# Todo backend with OpenFeature

The same Todo server as [`todo-backend-typescript`](../todo-backend-typescript), written against [OpenFeature](https://openfeature.dev) with the FeatureHub OpenFeature provider (`featurehub-openfeature-node-sdk`) instead of the FeatureHub SDK's own API. It serves the same API, evaluates the same features, and passes the same end-to-end tests (`examples/todo-server-tests`).

It shows:

- the provider taking its connection from the environment, as the FeatureHub Node SDK does;
- a `configFactory` that attaches FeatureHub's own extras to the config the provider runs on: a Redis store, the YAML store and interceptor, and a Segment usage plugin;
- evaluation with an OpenFeature context per request, and `client.track` for named usage events.

The SDK example's OpenTelemetry integration (`featurehub-usage-opentelemetry`) is left out: with OpenFeature, use OpenFeature's own OpenTelemetry hooks instead ([With OpenTelemetry](#with-opentelemetry)).

## Features

| Feature                      | Type    | Effect on a todo's title                             |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `FEATURE_TITLE_TO_UPPERCASE` | boolean | upper-cases every title when on                      |
| `FEATURE_STRING`             | string  | a todo titled `buy` becomes `buy <value>`            |
| `FEATURE_NUMBER`             | number  | a todo titled `pay` becomes `pay <value>`            |
| `FEATURE_JSON`               | JSON    | a todo titled `find` becomes `find <value of "foo">` |

Each request is evaluated for the user in the URL, with the country `new_zealand`, the device `browser` and the platform `macos`.

## Running

```bash
pnpm install
pnpm run start
```

The server listens on port 8099 (`TODO_PORT` changes it).

### With FeatureHub

```bash
export FEATUREHUB_EDGE_URL=http://localhost:8085/
export FEATUREHUB_CLIENT_API_KEY=<a client-evaluated API key, containing *>
pnpm run start
```

The provider streams by default. Set `FEATUREHUB_CONNECT_TYPE=active` and `FEATUREHUB_CONNECT_INTERVAL=30s` to poll instead (the SDK's older `FEATUREHUB_POLLING_INTERVAL` also works). A server-evaluated key goes in `FEATUREHUB_SERVER_API_KEY`.

### With Redis

Set `FEATUREHUB_REDIS_URL` (for example `redis://localhost:6379`) as well, and the features are kept in Redis: several servers share one copy, and a server starts with them even when FeatureHub cannot be reached. `FEATUREHUB_REDIS_POLL_INTERVAL` sets how often, in seconds, it checks Redis for other servers' updates (default 3). `GET /health/disconnect` closes the connection to FeatureHub, leaving only Redis.

### With a local YAML file, and no FeatureHub

With no `FEATUREHUB_EDGE_URL` or API key, point `FEATUREHUB_LOCAL_YAML` at a file of feature values, such as the [`flags.yaml`](flags.yaml) here:

```bash
FEATUREHUB_LOCAL_YAML=$PWD/flags.yaml pnpm run start
```

The YAML store creates the features, and the YAML interceptor supplies their values, picking up edits to the file while the server runs.

### With Segment

Set `SEGMENT_WRITE_KEY` and run `pnpm run segment`. Feature evaluations, and the `todo-add` and `todo-remove` events the server tracks, go to Segment.

### With OpenTelemetry

OpenFeature has its own OpenTelemetry support, as hooks (`@openfeature/open-telemetry-hooks`), which work with any provider, this one included. Add them rather than FeatureHub's `featurehub-usage-opentelemetry` plugin:

```bash
pnpm add @openfeature/open-telemetry-hooks @opentelemetry/api @opentelemetry/sdk-node
```

Set up the OpenTelemetry SDK as usual (tracing for spans, metrics for `MetricsHook`, logs for `EventHook`), then register the hooks, for example in `src/app.ts` before `OpenFeature.setProvider(provider)`:

```ts
import { MetricsHook, SpanHook } from "@openfeature/open-telemetry-hooks";

OpenFeature.addHooks(new SpanHook(), new MetricsHook());
```

Each flag evaluation then becomes a span (or a log event, with `EventHook`) and is counted in the metrics, with the flag's key, value, variant and reason. The variant is the id of the FeatureHub strategy that matched. FeatureHub's own details are in the evaluation's flag metadata, and the hooks' `attributeMapper` option can add them as attributes:

```ts
new SpanHook({
  attributeMapper: (_hookContext, details) => ({
    "featurehub.feature_version": details.flagMetadata["featureVersion"],
    "featurehub.feature_type": details.flagMetadata["featureType"],
  }),
});
```

The hooks see evaluations only. Events recorded with `client.track` (`todo-add`, `todo-remove`) still go to FeatureHub's usage plugins (Segment, here), not to the hooks. Nor do the hooks read feature overrides from OpenTelemetry baggage, as `featurehub-usage-opentelemetry`'s interceptor does.

## Trying it

```bash
curl -X POST http://localhost:8099/todo/sam -H 'Content-Type: application/json' -d '{"title": "buy"}'
curl http://localhost:8099/todo/sam
```

Turn `FEATURE_TITLE_TO_UPPERCASE` on or off in FeatureHub (or in the YAML file) and list the todos again.

| Endpoint                                        |                                    |
| ----------------------------------------------- | ---------------------------------- |
| `GET /todo/{user}`                              | list the todos                     |
| `POST /todo/{user}`                             | add a todo (`{"title": "..."}`)    |
| `PUT /todo/{user}/{id}/resolve`                 | resolve a todo                     |
| `DELETE /todo/{user}/{id}`                      | remove a todo                      |
| `DELETE /todo/{user}`                           | remove every todo                  |
| `GET /health/liveness`, `GET /health/readiness` | 200 once the provider is ready     |
| `GET /health/disconnect`                        | close the connection to FeatureHub |

## How it differs from the SDK example

| FeatureHub SDK example                                     | This example                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `new EdgeFeatureHubConfig(url, key)` and `init()`          | `new FeatureHubProvider({ configFactory })` and `OpenFeature.setProvider(provider)`                        |
| stores, interceptors and plugins on the config             | the same, inside `configFactory`                                                                           |
| `fhConfig.newContext().userKey(user).country(...).build()` | `{ targetingKey: user, country: ... }`, passed to each evaluation                                          |
| `ctx.isSet(key)`, `ctx.getString(key)`                     | `client.getStringDetails(key, default, context)`, checking for no error and a reason other than `DISABLED` |
| `ctx.recordNamedUsage(name, params)`                       | `client.track(name, context, params)`                                                                      |
| `fhConfig.readyness === Readyness.Ready`                   | `client.providerStatus === ProviderStatus.READY`                                                           |
