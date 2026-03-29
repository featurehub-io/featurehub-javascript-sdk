# featurehub-usage-segment

[Twilio Segment](https://segment.com) integration for the [FeatureHub](https://featurehub.io)
JavaScript SDK.

This package provides two classes that connect FeatureHub feature evaluation to Twilio Segment Analytics.
They can be used independently or together.

---

## Installation

```bash
npm install featurehub-usage-segment
# or
pnpm add featurehub-usage-segment
```

`@segment/analytics-core` and `featurehub-javascript-core-sdk` (or one of the platform packages)
are peer dependencies and must be installed alongside it.

---

## Classes

### `SegmentUsagePlugin`

A `UsagePlugin` that forwards every FeatureHub usage event to Segment as a `track` call.

Each time a feature is evaluated, FeatureHub emits a usage event. `SegmentUsagePlugin` picks
these up and calls `analytics.track()` with:

- **`event`** — the FeatureHub event name (e.g. `"feature"`, `"feature-collection"`).
- **`userId`** — `event.userKey` if set, otherwise the value of `anonymous` (default
  `"anonymous"`).
- **`properties`** — the full usage record from `event.collectUsageRecord()`, merged with any
  `defaultPluginAttributes` you have set on the plugin instance.

#### Setup

Pass a factory function that returns your `Analytics` instance. Using a factory rather than the
instance directly ensures the plugin always picks up the active analytics object, which is useful
in server-side environments where the instance may be request-scoped.

```typescript
import { Analytics } from "@segment/analytics-node";
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";
import { SegmentUsagePlugin } from "featurehub-usage-segment";

const analytics = new Analytics({ writeKey: "YOUR_WRITE_KEY" });
const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

fhConfig.addUsagePlugin(new SegmentUsagePlugin(() => analytics));

await fhConfig.init();
```

#### Anonymous users

When a FeatureHub context has no `userKey` set, the `userId` sent to Segment defaults to
`"anonymous"`. You can change this per plugin instance:

```typescript
const plugin = new SegmentUsagePlugin(() => analytics);
plugin.anonymous = "guest";
fhConfig.addUsagePlugin(plugin);
```

#### Adding fixed properties to every event

Use `defaultPluginAttributes` to attach properties that should appear on every Segment event
emitted by this plugin:

```typescript
const plugin = new SegmentUsagePlugin(() => analytics);
plugin.defaultPluginAttributes["service"] = "checkout";
plugin.defaultPluginAttributes["region"] = "us-east-1";
fhConfig.addUsagePlugin(plugin);
```

---

### `FeatureHubSegmentEnrichmentPlugin`

A Segment `CorePlugin` (type `"enrichment"`) that enriches **every** outgoing Segment `track`
event with the current FeatureHub context attributes.

Rather than manually adding feature flag context to each `track` call, register this plugin with
your Segment `Analytics` instance and it will automatically attach the FeatureHub context usage
record to a `"context"` property on every tracked event.

#### Setup

```typescript
import { Analytics } from "@segment/analytics-node";
import { EdgeFeatureHubConfig } from "featurehub-javascript-node-sdk";
import { FeatureHubSegmentEnrichmentPlugin } from "featurehub-usage-segment";

const analytics = new Analytics({ writeKey: "YOUR_WRITE_KEY" });
const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

await fhConfig.init();
const ctx = await fhConfig.newContext().userKey("user-123").build();

const enrichment = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => ctx);

await analytics.register(enrichment);
```

The `contextSource` setter accepts a factory function so that you can return a different context
per call — for example in a request-scoped setup where each request has its own FeatureHub
context:

```typescript
// Express middleware example
app.use((req, _res, next) => {
  fhConfig
    .newContext()
    .userKey(req.user.id)
    .build()
    .then((ctx) => {
      req.fhCtx = ctx;
      next();
    });
});

const enrichment = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => req.fhCtx);

await analytics.register(enrichment);
```

---

## Using both classes together

`SegmentUsagePlugin` sends FeatureHub evaluation events _to_ Segment. `FeatureHubSegmentEnrichmentPlugin`
enriches Segment events _from_ FeatureHub context. They address different directions of the same
integration and complement each other:

```typescript
const plugin = new SegmentUsagePlugin(() => analytics);
fhConfig.addUsagePlugin(plugin);

const enrichment = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => ctx);
await analytics.register(enrichment);
```

With both in place, feature evaluations are tracked in Segment with full context, and every other
Segment event your application emits is automatically annotated with the FeatureHub context that
was active at the time.

---

## License

MIT
