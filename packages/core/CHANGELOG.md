# featurehub-javascript-core-sdk

## 2.1.0

### Minor Changes

- 78e9f71: Configuration follows the FeatureHub protocol:
  - **Poll intervals** must be `0` (poll once) or at least 5 seconds; `restActive()` and `restPassive()` throw an `InvalidConfigurationError` otherwise. `restActive(0)` and `restPassive(0)` now poll once, where they were silently ignored.
  - **Node environment variables:** `FEATUREHUB_CONNECT_TYPE` (`active`, `passive` or `streaming`) and `FEATUREHUB_CONNECT_INTERVAL` (such as `30s`) choose the default connection mode. The legacy `FEATUREHUB_POLLING_INTERVAL` and `FEATUREHUB_POLLING_PASSIVE` are read as before, only when neither new variable is set, and log a deprecation warning.
  - **A host URL with a query string** keeps its parameters, ahead of the SDK's own; it used to produce a broken URL. `featureUrl()` now returns a working URL.
  - **`modifyRequestFunction`** can no longer replace the SDK's `x-featurehub` header, and headers it sets on a replaced headers object are now sent.

- 78e9f71: The config and repository now say when the connection stops for good. `connectionFailed` and `environmentStale` are available on `FeatureHubConfig` and `FeatureHubRepository`, and `addConnectionEventListener` tells a `ConnectionEvent` (`ConnectionFailed` or `EnvironmentStale`) once, as an event of its own. Readiness alone cannot always say it: during a server-evaluated context change readiness is already `Stale`, so a failure then changes nothing a readiness listener sees. A listener added after the event is told at once.
- 78e9f71: Context attributes can now be date-times: `context.attributeValue("signedUp", new Date(...))`, or a list of them. They are sent to FeatureHub Edge as UTC ISO-8601 to the second (`2026-11-17T02:47:28Z`; any fraction of a second is dropped), evaluated locally by DATE and DATETIME strategies as dates (and by every other kind of strategy, and the percentage key, as their ISO-8601 string), and recorded in usage events as the same ISO-8601 strings. DATETIME strategy values are compared to the second as well. An invalid `Date` is left out rather than causing an error.
- 78e9f71: The models are regenerated from the FeatureHub Edge API 1.2.0. `FeatureState.version` and `type` are now required, and `l` may be `null`; `FeatureEnvironmentCollection` has `pollInterval`; `StrategyAttributeWellKnownNames` gains `FhubWhenActive`; and a strategy attribute's `conditional`, `fieldName` and `type` are required. `BaseRolloutStrategyAttribute`, which the API no longer defines, is removed: use `RolloutStrategyAttribute`.
- 78e9f71: `FeatureStateHolder.getValue()` now says whether the value came from a percentage rollout matched locally (`EvaluatedFeature.split`, and `Applied.split` from strategy evaluation), so an OpenFeature provider can report `SPLIT` rather than `TARGETING_MATCH`. For a feature with no strategies, its `strategyId` is now the strategy the server applied (`v`, for a server-evaluated key); before, it was always undefined. Usage events carry that strategy id too.
- 78e9f71: Extra headers for FeatureHub Edge, for an API gateway, a proxy, extra authentication or tracing: `fhConfig.headers({...})`, or a function called for each request so a value such as a short-lived token stays current. They are sent with every poll and every streaming connection and reconnection. The SDK's own protocol headers (`x-featurehub`, `If-None-Match`, `Last-Event-ID`) always win over a header of the same name, in any case. A browser's `EventSource` cannot send headers, so in a browser they are only sent when polling, and a warning is logged if they are configured for streaming. The React and Solid `FeatureHub` components take a `headers` prop.
- 78e9f71: Add `FeatureStateHolder.getValue()`, which returns the evaluated feature (value plus the id of the rollout strategy that matched, if any) in one call. It is the public equivalent of the internal evaluation the typed getters already perform, so adapters such as the OpenFeature providers can report `variant`/`TARGETING_MATCH` without reaching into internals.

  `forceClose()` is now part of the `FeatureHubConfig` interface, allowing the owner of a config (for example an OpenFeature provider's `onClose`) to tear down the edge connection, repository and usage plugin immediately rather than relying on the reference-counted `close()`.

  The node and client SDK patches republish them after this core release so their published `featurehub-javascript-core-sdk` dependency is rewritten to `^2.1.0` (pnpm replaces `workspace:^` at publish time). This guarantees consumers of the OpenFeature providers get a core version that actually exposes `getValue()` and `forceClose()`, even with an existing lockfile.

- 78e9f71: Strategies can now use `fhubWhenActive`, an attribute FeatureHub sets to a UTC date-time: the strategy applies when the clock of the machine the SDK runs on compares with it as the attribute's conditional says, so a feature can switch on at a given moment (`GREATER_EQUALS`) or off at one (`LESS`). `EQUALS`, `NOT_EQUALS`, `GREATER`, `GREATER_EQUALS`, `LESS` and `LESS_EQUALS` are supported; any other conditional never matches, and the attribute's type is ignored. The comparison is to the whole second: the clock and the time are both truncated, so `EQUALS` matches for the whole of that second. It combines with the strategy's other attributes and percentages, is worked out on every evaluation, and is never taken from the context: a context attribute named `fhubWhenActive` is not sent to Edge. It is compared with the machine's clock in whole seconds since the epoch.
- 78e9f71: Polling now takes its interval override from the `pollInterval` FeatureHub sends with each environment, in whole seconds, rather than from the `Cache-Control` header, which FeatureHub never meant as a polling signal and which is no longer read. The smallest `pollInterval` of at least 5 seconds replaces the configured interval, shorter or longer; values below 5 are ignored; a response without one returns to the configured interval; and an interval of `0` (poll once) never starts polling. `PollingBase.parseCacheControl` is removed, replaced by `applyPollInterval`.
- 78e9f71: Readiness follows the FeatureHub protocol, with a new `Readyness.Stale` state: features are held and keep being resolved, but may not be current.
  - A failure **after** features have been received makes readiness `Stale`, not `Failed`, and the last features keep being resolved. `Failed` now means only that the connection failed before any features arrived, and it is final.
  - A server-evaluated key's context change goes from `Ready` to `Stale` until the new context's features arrive, instead of `NotReady` (the old features are still held).
  - A stale environment (a 236 when polling, `edge.stale` when streaming) makes readiness `Stale` for good.
  - The repository exposes `connectionFailed` and `environmentStale`, and `waitForReady` returns as soon as nothing more can arrive.
  - A features notification that is not a list is ignored, and features without a version or a type are skipped.

  The React `FeatureHub` component renders its children while readiness is `Ready` or `Stale`, so a context change no longer unmounts the app until the new context's features arrive.

  If you check `readiness === Readyness.Failed` to detect a lost connection, also check for `Readyness.Stale` (with `connectionFailed`).

- 78e9f71: The SDK now speaks generation 2 of the FeatureHub protocol: every poll and streaming connection sends `sdk_version=2`, which tells Edge it can skip resending features the SDK already has.
  - **Last-Event-ID:** streaming keeps the id of the last event it received and sends it when it reconnects, so Edge can hold a quiet connection open without resending features. A browser's `EventSource` does this itself; in Node the SDK now makes every reconnection itself, sending it. A context change never sends the old context's id.
  - **Quiet connections and clean byes:** a connection that lasts and ends with Edge's `bye` is a clean end, not a failure, however many come in a row.
  - **Short connections:** a connection that ends within 10 seconds of its request (a CDN or cache replaying a closed stream) counts as a failure even if it ended with a `bye`, and a warning is logged after three in a row.
  - **Backoff:** Node backs off between failed connections (`FeatureHubEventSourceClient.reconnectPolicy`), and `reconnectPolicy.maxAttempts` optionally stops streaming for good after that many reconnection attempts.

- 78e9f71: The feature snapshot client (feature snapshot protocol 2.0.0): `featureSnapshotConfig({ url })` gives a config whose features come from your own server, a snapshot server, instead of FeatureHub Edge. It polls actively or passively, sends the context as query parameters (or, with `sendContext: false`, evaluates locally), and sends back the server's ETag for that context. A `4xx` other than `429` stops it for good. `decodeFeatureSnapshot` reads a snapshot. The client computes no SHA.

  Also:
  - `EdgeService.contextChange` is given the context's attributes as well as its header
  - a repository's `apply` takes an optional time to evaluate at, used for `fhubWhenActive` and for the current time a `DATE` or `DATETIME` attribute uses when the context does not supply it
  - `parseUtcDateTime` is exported

- 78e9f71: NUMBER strategy attributes are now strict: a value is a number only if it is a finite number, or a string that is exactly a decimal integer or float (`12`, `-5`, `2.5`). Strings such as `12abc`, `1e3`, `0x10`, ` 3`, `1,000` or `Infinity` were read with `parseInt` / `parseFloat` and could match; now a supplied value that is not a number never matches (`NOT_EQUALS` and `EXCLUDES` included), and strategy values that are not numbers are ignored. A strategy with neither a percentage nor attributes no longer stops the percentage strategies after it from matching. The SDK now runs the FeatureHub golden fixture of rollout strategy results in its tests.

### Patch Changes

- 78e9f71: Build the `x-featurehub` header and `contextSha` exactly as the FeatureHub protocol specifies, so every SDK sends the same values for the same context:
  - attribute keys are now URL-encoded as well as values, and attributes with no value are left out instead of being sent as `key=`
  - `contextSha` is the SHA-256 of the header as 64 lowercase hex characters (it was base64url), or `0` when there is no header
  - streaming connections now send `contextSha` too, and the browser's `xfeaturehub` query parameter is encoded with `encodeURIComponent`
  - polling clears its ETag when the context changes, and no longer keeps the ETag of a response whose context changed while it was in flight, or whose body could not be decoded

  Edge does not read `contextSha`, so feature evaluation is unchanged; a CDN in front of Edge will see each context's cache key change once.

- 8188272: The browser SDK computes the contextSha in JavaScript when the Web Crypto API is missing, as it is in a page that is not a secure context (served over plain http, other than localhost). Before, a server-evaluated key could not change context there: streaming kept the old context's features, and polling failed. Streaming now hashes the context with `FeatureHubEventSourceClient.contextHash`, which the browser SDK sets to its own hash (core's default remains the Web Crypto API, which Node always has).
- 78e9f71: DATE and DATETIME strategies, and `fhubWhenActive`, now read date-time strings strictly as ISO-8601 and always as UTC: a date-time without an offset (`2021-05-05T10:00:00`) is UTC, rather than the machine's local time, so it matches the same way in every time zone and as FeatureHub Edge does. A string that is not ISO-8601 (`2020-06-15 10:00:00Z`, `15/06/2020`) is not a date-time and never matches.
- 8188272: A host whose query string has a parameter name that is not valid percent-encoding (`?token%=abc`) no longer makes the config's constructor throw a `URIError`: the parameter is kept as written.
- 78e9f71: A feature whose lock (`l`) is absent or null is now unlocked: `locked` and `isLocked()` return `false` rather than `null`. A full set no longer calls the listeners of a feature that never existed, while a feature appearing or being deleted still calls them.
- 78e9f71: - A rollout strategy whose `percentage` is `null` now matches on its attributes; it never matched. A strategy whose `attributes` are `null` is now a plain percentage strategy; evaluating it threw an error. `null` now means the same as an absent field, as the protocol requires.
  - A context change on a polling connection that has been closed now makes one request, so the new context's features arrive, without starting polling again. It makes none once the connection has failed or the environment is stale.
- 8188272: A context change made while a poll is in flight no longer waits for ever when the request for the new context fails with a network error or a 5xx: its `build()` is told of the failure, and polling carries on.
- 78e9f71: Polling and streaming fixes, following the FeatureHub protocol:
  - polling now stops for good on any 4xx (a bad API key was polled forever, as the 400/404 check never matched the error it was given), and the repository is told the connection failed
  - a context change while a poll is in flight now fetches for the new context, rather than being answered by the old context's response
  - polling no longer stays busy for ever when the browser's local cache satisfies a poll, which stopped every later poll
  - a poll that fails with no further poll scheduled (an interval of 0, or passive polling) now rejects, rather than never settling
  - passive polling with an interval of 0 polls once, rather than on every evaluation
  - a response that is not an array of environments is rejected (and retried) instead of being applied; absent or null features mean none, and an empty array of environments is an empty set of features rather than a failure
  - a streaming `edge.stale` config event, whatever its value, closes the stream for good; it was read as a number of seconds to wait before reconnecting

- 8188272: The feature snapshot client makes one request at a time, and keeps one poll timer, when several context changes wait on a request in flight. Before, they could all start a request when it finished, leaving two polling timers running for good (one of them still polling after `close()`).
- 78e9f71: Streaming fixes, following the FeatureHub protocol:
  - Node: the `x-featurehub` header (the context of a server-evaluated key) is now sent when streaming. The `eventsource` library ignores a `headers` option since v3, so Edge evaluated without the context and returned the wrong values with no error.
  - Connection errors are classified as the protocol says: any 4xx, a `failure` event, or a browser `EventSource` closing (which hides the status) stops streaming for good and tells the repository the connection failed. A 5xx, or a response that is not an event stream, is temporary: Node reconnects with a growing, configurable backoff (`FeatureHubEventSourceClient.reconnectPolicy`). A dropped connection the event source re-establishes itself is a bye. Previously any error before the first features was a permanent failure, any 5xx above 504 was too, and in Node the HTTP status was never read.

## 2.0.3

### Patch Changes

- e193e87: Create the usage adapter once per repository rather than on every `repository()` call. Because `newContext()` calls `repository()`, every context previously registered a usage stream that was never removed, so feature evaluation fanned out over an ever-growing list of listeners and got progressively slower for the life of the process.
- 90db9f7: Support for preventing polling on page change for Web 1.0 apps when the poll is not within the requisite interval

## 2.0.2

### Patch Changes

- cd5a589: focus on making more robust react and solid sdks
- cd5a589: Minor fixes
- 351f41e: A console.log was found in the polling adapter, this removes it

## 2.0.1

### Patch Changes

- be61eae: ensure ^ versions
- 11081d6: polling client has a race condition which blocks the shutdown in certain circumstance
- be61eae: Exposing some repository functionality externally, updating docs

## 2.0.0

### Major Changes

- 5c4cee5: Major SDK release for the 2.0 release

## 2.0.0-rc1.0

### Major Changes

- 5c4cee5: Major SDK release for the 2.0 release
