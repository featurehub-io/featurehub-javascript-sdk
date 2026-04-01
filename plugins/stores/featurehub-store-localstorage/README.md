# featurehub-store-localstorage

Browser storage persistence for the [FeatureHub](https://featurehub.io) JavaScript SDK.
       
HALTED: the polling delegate already does this in a browser. It doesn't
exist for streaming, but it is there for polling.


Without this plugin, a browser-based application must wait for the FeatureHub connection to
deliver the current feature state before it can render. This adds latency on every page load or
navigation. `LocalSessionStore` eliminates that wait by caching feature state in the browser's
`sessionStorage` (or `localStorage`) and replaying it immediately on startup, before the network
connection has been established.

---

## How it works

`LocalSessionStore` registers itself as a `RawUpdateFeatureListener` on the FeatureHub
repository. It uses the feature URL as the storage key, so each environment's state is stored
separately.

**On construction** — if the storage key already contains feature data from a previous session
or page load, it is parsed and loaded into the repository immediately. Consumers can read feature
values right away without waiting for a network round-trip.

**While running** — every time the repository receives an update from FeatureHub (via SSE or
polling), the store writes the new state to storage so it is available for the next page load.
Updates that originated from the store itself are ignored to prevent feedback loops.

**On config change** — if the FeatureHub config switches to a different feature URL (e.g. the
API key changes), the store clears its in-memory copy and loads fresh state from the new storage
key.

---

## Installation

```bash
npm install featurehub-store-localstorage
# or
pnpm add featurehub-store-localstorage
```

---

## Usage

### Default — sessionStorage

`sessionStorage` is the default. Cached state is scoped to the current browser tab and is
discarded when the tab is closed. This is the safest default: users always get a fresh load on
their next visit, and state cannot leak between tabs.

```typescript
import { EdgeFeatureHubConfig } from 'featurehub-javascript-client-sdk';
import { LocalSessionStore } from 'featurehub-store-localstorage';

const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

const store = new LocalSessionStore(fhConfig);

await fhConfig.init();
```

Construct the store **before** calling `fhConfig.init()` so that any cached state is replayed
into the repository before the first readiness listeners fire.

### Using localStorage instead

Pass the global `localStorage` object as the second argument to persist state across page loads
and browser sessions. With this option, returning users will see feature values immediately even
on a cold start, before the FeatureHub connection is established.

```typescript
const store = new LocalSessionStore(fhConfig, localStorage);
```

### Custom storage

Any object implementing the browser `Storage` interface can be passed — useful in tests or
server-side rendering environments that provide a compatible shim.

```typescript
const store = new LocalSessionStore(fhConfig, myCustomStorage);
```

---

## Lifecycle

```
new LocalSessionStore(config, storage?)
        │
        └─ registers as RawUpdateFeatureListener
        └─ loads and replays any cached state immediately
        │
  await fhConfig.init()   ← live updates begin arriving and are written to storage
        │
  [application runs]
        │
store.close()             ← deregisters the listener; storage is left intact
```

Call `store.close()` when tearing down the FeatureHub config (e.g. in a single-page app that
unmounts the root component) to deregister the listener cleanly.

---

## Choosing between sessionStorage and localStorage

| | `sessionStorage` (default) | `localStorage` |
|---|---|---|
| Scope | Single tab, single session | Persists across tabs and sessions |
| Cleared on tab close | Yes | No |
| Good for | Most SPAs; avoids stale state | Apps where instant startup on return visits matters |
| Risk | Slightly slower cold starts on return visits | May serve briefly stale flags until the live connection updates |

In either case the stored data is only ever used as a warm-start cache. The live FeatureHub
connection will always deliver the authoritative current state and overwrite any cached values
once it is established.

---

## License

MIT
