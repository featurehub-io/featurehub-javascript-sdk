# featurehub-yaml-interceptor

Local YAML file feature overrides for the [FeatureHub](https://featurehub.io) JavaScript SDK.

This package provides two classes for working with feature flags from a local YAML file during
development and testing, without needing a live FeatureHub connection. They are intentionally
not suited for production use — the YAML file is read from the local filesystem and is not
authenticated or versioned by FeatureHub.

**Node.js only.** Requires Node.js ≥ 20.

---

## YAML file format

Both classes read from a YAML file with a single top-level `flagValues` map. Keys are feature
flag keys; values are the overridden values.

```yaml
# featurehub-features.yaml
flagValues:
  my-boolean-flag: true
  my-string-flag: "hello world"
  my-number-flag: 42
  my-json-flag:
    warehouse: east
    capacity: 500
  my-null-flag: ~
```

Type inference follows these rules:

| YAML value | Inferred type |
|------------|---------------|
| `true` / `false` (native or string) | Boolean |
| Integer or float | Number |
| Any other string | String |
| Object or array | JSON (serialised with `JSON.stringify`) |
| `~` / `null` | String with no value |

The default file name is `featurehub-features.yaml` in the current working directory. This can
be overridden by passing a path to the constructor or by setting the `FEATUREHUB_LOCAL_YAML`
environment variable.

---

## Installation

```bash
npm install featurehub-yaml-interceptor
# or
pnpm add featurehub-yaml-interceptor
```

---

## Classes

### `LocalYamlValueInterceptor`

Intercepts individual feature lookups and substitutes values from the YAML file, leaving all
other features unaffected. This is the right choice when you want to override a subset of flags
during development while the rest continue to come from FeatureHub normally.

It implements `FeatureValueInterceptor` and is registered with the config, not with the
repository directly, so it integrates cleanly with the rest of the interceptor chain.

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-node-sdk';
import { LocalYamlValueInterceptor } from 'featurehub-yaml-interceptor';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

fhConfig.addValueInterceptor(new LocalYamlValueInterceptor());

await fhConfig.init();
```

#### File path resolution

The file path is resolved in this order of precedence:

1. The `filename` argument passed to the constructor
2. The `FEATUREHUB_LOCAL_YAML` environment variable
3. `featurehub-features.yaml` in the current working directory

```typescript
// Explicit path
new LocalYamlValueInterceptor('./config/local-flags.yaml');

// Via environment variable (constructor called with no argument)
// FEATUREHUB_LOCAL_YAML=./config/local-flags.yaml
new LocalYamlValueInterceptor();
```

#### Live reload during development

Pass `{ watchForChanges: true }` to poll the YAML file every 500 ms and pick up edits without
restarting the process. This is useful when iterating on feature flag scenarios locally.

```typescript
fhConfig.addValueInterceptor(
  new LocalYamlValueInterceptor('./local-flags.yaml', { watchForChanges: true })
);
```

Call `interceptor.close()` to stop the file watcher when it is no longer needed.

#### Locked features

The interceptor does not check whether a feature is locked — it will override locked features
the same as unlocked ones. If you need to respect locks, check `featureState?.l` before
registering the interceptor, or use a wrapper.

---

### `LocalYamlFeatureStore`

Reads the YAML file once at construction and loads all entries into the FeatureHub repository
as `FeatureState` objects. This replaces the repository's feature state entirely from the file,
making it useful for unit tests or offline development scenarios where no FeatureHub connection
is available at all.

Unlike `LocalYamlValueInterceptor`, the feature store does not intercept individual lookups — it
populates the repository directly, so `fhConfig.init()` is not required.

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-node-sdk';
import { LocalYamlFeatureStore } from 'featurehub-yaml-interceptor';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

// Populate the repository from the YAML file — no network call needed
new LocalYamlFeatureStore(fhConfig);

// Features are immediately available
const ctx = await fhConfig.newContext().build();
console.log(ctx.getBoolean('my-boolean-flag')); // true
```

Each feature entry is assigned a stable synthetic ID derived from the first 8 hex characters of
the SHA-256 hash of its key, so IDs are consistent across runs without requiring a FeatureHub
server.

`LocalYamlFeatureStore` does not support live reload; it reads the file exactly once. For
iterative development with hot-reload, use `LocalYamlValueInterceptor` with
`{ watchForChanges: true }` instead.

---

## Choosing between the two classes

| | `LocalYamlValueInterceptor` | `LocalYamlFeatureStore` |
|---|---|---|
| Overrides only listed flags | Yes — other flags still come from FeatureHub | No — replaces all repository state |
| Requires live FeatureHub connection | Yes (for non-overridden flags) | No |
| Live reload | Yes (`watchForChanges: true`) | No |
| Suitable for unit tests | Yes | Yes (simpler setup) |
| Suitable for local dev with partial overrides | Yes | No |

---

## License

MIT
