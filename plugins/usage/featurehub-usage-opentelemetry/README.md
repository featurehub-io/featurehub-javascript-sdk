# featurehub-usage-opentelemetry

OpenTelemetry integration for the [FeatureHub](https://featurehub.io) JavaScript SDK.

This package provides three classes that connect FeatureHub feature evaluation to OpenTelemetry
tracing. They can be used independently or together.

**Node.js only.** This package requires Node.js ≥ 20. Browser environments are not supported
because two of the three classes rely on `AsyncLocalStorage` (via `node:async_hooks`) and on the
`@opentelemetry/context-async-hooks` context manager, neither of which is available in browsers.

---

## Installation

```bash
npm install featurehub-usage-opentelemetry
# or
pnpm add featurehub-usage-opentelemetry
```

`@opentelemetry/api` is a peer dependency and must be installed alongside it.

---

## Classes

### `OpenTelemetryTrackerUsagePlugin`

A `UsagePlugin` that records each feature evaluation as an attribute (or event) on the active
OpenTelemetry span.

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-node-sdk';
import { OpenTelemetryTrackerUsagePlugin } from 'featurehub-usage-opentelemetry';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

fhConfig.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin());
// Optional: customise the attribute prefix (default "featurehub.")
// fhConfig.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin('myapp.feature.'));

// Optional: attach evaluations as span events instead of attributes
// fhConfig.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin('featurehub.', true));
```

Each feature evaluation adds attributes to the active span of the form
`featurehub.<feature-key>`, making it straightforward to correlate feature flag states with
traces in your observability backend.

---

### Full-trace Feature Value consistency support

The `OpenTelemetryBaggagePlugin` and `OpenTelemetryFeatureInterceptor` work as a complementary
pair to provide **Full-trace Feature Value consistency support**.

The goal is to ensure that once feature values are determined at the entry point of a distributed
trace, those same values are used consistently everywhere the trace travels — across microservices,
into message queues, through event processors — even if the feature flag values change in
FeatureHub partway through, or if context differences (user key, country, etc.) would otherwise
cause a different variant to be selected on a downstream service.

As long as every application in the system registers both classes, feature values are frozen at
the point of first evaluation and propagated transparently via the W3C `baggage` header.

#### How it works

1. **Origin service** — `OpenTelemetryBaggagePlugin` fires synchronously each time a feature is
   evaluated. It encodes the evaluated key/value pairs into the `fhub` W3C baggage entry (e.g.
   `fhub=MY_BOOL=true,MY_NUM=42,MY_STR=hello%20world`). It uses `AsyncLocalStorage` to
   accumulate all evaluations made within the same request chain and updates the active
   OpenTelemetry context via `enterWith` so that OTel-instrumented outgoing HTTP clients
   automatically propagate the `fhub` baggage header with no extra wiring.

2. **Downstream services** — When a request arrives carrying the `fhub` baggage header, the
   `OpenTelemetryFeatureInterceptor` intercepts every feature lookup and returns the value from
   the incoming baggage instead of the current repository value. Because the baggage is carried
   forward by every subsequent outgoing call, the frozen values continue to propagate for the
   lifetime of the trace.

3. **Conflict protection** — If a downstream service evaluates a feature with a value that
   differs from the one already in the baggage (meaning the interceptor is not registered
   correctly on that service), `OpenTelemetryBaggagePlugin` logs a warning and rejects the
   overwrite, keeping the original frozen value intact.

#### Setup

Register both classes on every service that participates in a distributed trace:

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-node-sdk';
import {
  OpenTelemetryBaggagePlugin,
  OpenTelemetryFeatureInterceptor,
} from 'featurehub-usage-opentelemetry';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

// Writes evaluated feature values into the fhub baggage entry so they
// propagate to every downstream service in the trace.
fhConfig.addUsagePlugin(new OpenTelemetryBaggagePlugin());

// Reads feature values from the incoming fhub baggage entry so that this
// service uses the same values as the origin, regardless of any changes
// that may have occurred since the trace started.
fhConfig.addValueInterceptor(new OpenTelemetryFeatureInterceptor());

await fhConfig.init();
```

Both classes must be registered on **every** service in the call graph for consistency to be
guaranteed end-to-end. A service that registers only the plugin but not the interceptor will
write its own (potentially different) values into the baggage and trigger a conflict warning on
the next service.

#### Locked features

By default the interceptor will not override features that are marked as locked in FeatureHub,
preserving the operator's intent. To allow locked features to be overridden by baggage:

```typescript
fhConfig.addValueInterceptor(new OpenTelemetryFeatureInterceptor(true));
```

#### Why browser environments are not supported

The consistency mechanism depends on two Node.js-specific capabilities:

- **`AsyncLocalStorage`** (`node:async_hooks`) — used by `OpenTelemetryBaggagePlugin` to
  accumulate feature entries across successive evaluations within the same async request chain,
  and to propagate updated baggage to descendent async operations without wrapping caller code.
- **`@opentelemetry/context-async-hooks`** — the standard Node.js OTel context manager, whose
  internal `AsyncLocalStorage` is updated via `enterWith` so that OTel-instrumented HTTP clients
  automatically inject the `fhub` header without any additional wiring.

Neither mechanism exists in browser runtimes. The `OpenTelemetryTrackerUsagePlugin` class has no
such dependency and can be used in environments that support OpenTelemetry spans, but the
Full-trace Feature Value consistency pair is Node.js only.

---

## Baggage format

The `fhub` baggage value is a comma-separated list of `KEY=url-encoded-value` pairs in
**alphabetical key order**:

```
fhub=MY_BOOL=true,MY_NUM=42,MY_STR=hello%20world
```

Keys with a `null`/`undefined` value are written without an `=` sign:

```
fhub=MY_NULL_KEY,MY_STR=value
```

Alphabetical ordering allows the interceptor to abort its search early once the current key
in the list is lexicographically greater than the one being looked up.

---

## License

MIT
