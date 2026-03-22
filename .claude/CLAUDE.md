# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Install dependencies

```bash
pnpm install
```

### Build

```bash
pnpm run build:packages        # Build all SDK packages
pnpm run build:core            # Build only core package
pnpm run build:js              # Build only browser client package
pnpm run build:node            # Build only Node.js package
pnpm run build:react           # Build only React package
pnpm run build:solid           # Build only SolidJS package
```

### Test

```bash
pnpm run test:packages         # Run all package unit tests
pnpm --filter './packages/core' run test   # Test core package only
pnpm --filter './packages/js' run test     # Test browser package only
pnpm --filter './packages/node' run test   # Test node package only

# Run a single test file (from within a package directory):
pnpm vitest run src/__tests__/polling_sdk.test.ts

# Integration tests (requires FeatureHub server running):
make test-server
make test-server-qa            # API-only tests, no FeatureHub server needed
make test-server-tags TAGS=@smoke
```

> **Important:** Plugin packages (under `plugins/`) resolve `featurehub-javascript-core-sdk` from
> the compiled `dist/` output, not TypeScript source. After changing any file under `packages/core/src/`,
> run `pnpm run build:core` before running tests in downstream plugin packages, or they will test
> against stale compiled output.

### Lint and Format

```bash
pnpm run lint                  # Check linting
pnpm run lint:fix              # Auto-fix lint issues
pnpm run format                # Check formatting
pnpm run format:fix            # Auto-fix formatting
pnpm run typecheck             # TypeScript type check across all packages
```

### Docker / Integration

```bash
make start-backend             # Start TypeScript backend example (full integration)
make start-backend-qa          # Start backend without FeatureHub connection
make image-backend             # Build full-stack Docker image
```

## Architecture

This is a **pnpm monorepo** with workspace packages under `packages/`, example apps under `examples/`, and usage tracking plugins under `plugins/usage/`.

### Package Dependency Chain

```
featurehub-javascript-core-sdk  (packages/core)
    ↓ (re-exported by both)
featurehub-javascript-client-sdk  (packages/js)   ← Browser/SPA
featurehub-javascript-node-sdk    (packages/node)  ← Node.js server
    ↓ (built on client-sdk)
featurehub-javascript-react-sdk   (packages/react)
featurehub-javascript-solid-sdk   (packages/solid)
```

The `core` package is **not published for direct use** — it contains all shared logic. The `js` (browser) and `node` packages re-export everything from core and add platform-specific implementations.

### Core Package (`packages/core/src/`)

Key files:

- **`edge_featurehub_config.ts`** — `EdgeFeatureHubConfig`: the main entry point for users. Manages connection lifecycle, context creation, `UsageAdapter` wiring, and the `EdgeType` (STREAMING / REST_ACTIVE / REST_PASSIVE). Exposes `addUsagePlugin()` and an `environmentId` getter (parses it from the API key).
- **`feature_hub_config.ts`** — `FeatureHubConfig` interface + `FHLog` logging class + `EdgeType` enum.
- **`featurehub_repository.ts`** — `FeatureHubRepository` interface + `Readyness` enum + `EdgeServiceProvider` type. The repository interface includes `registerUsageStream` / `removeUsageStream` and a `usageProvider` getter/setter.
- **`internal_feature_repository.ts`** — `InternalFeatureRepository` extends `FeatureHubRepository` with internal methods: `notify`, `notReady`, `valueInterceptorMatched`, `recordUsageEvent`, `usageProvider`, and `apply` (for strategy matching).
- **`client_feature_repository.ts`** — `ClientFeatureRepository`: holds all feature states, processes SSE/polling updates, fires readiness and usage events. On `broadcastReadynessState` it emits a `'readyness'` usage collection event to all registered usage streams.
- **`context_impl.ts`** — `BaseClientContext` (abstract base with usage-tracking methods), `ClientEvalFeatureContext` (client-side key), and `ServerEvalFeatureContext` (server-side key). `BaseClientContext` provides `used()`, `recordUsageEvent()`, `recordNamedUsage()`, `fillEvent()`, and `getContextUsage()` for usage instrumentation.
- **`interceptors.ts`** — `FeatureStateValueInterceptor` interface + `InterceptorValueMatch`: allows overriding feature values before they are returned (e.g. for local development overrides).
- **`network/polling_sdk.ts`** — `PollingBase` (abstract, platform-agnostic polling logic) + `FeatureHubPollingClient` (orchestrates polling, handles active/passive modes and cache expiry).
- **`network/featurehub_eventsource.ts`** — SSE streaming client. Injects `environmentId` (from config) into each `FeatureState` received, which is required for usage tracking.
- **`network/index.ts`** — `FeatureHubNetwork.defaultEdgeServiceSupplier` chooses the right transport based on `EdgeType`.
- **`usage/usage.ts`** — Full usage tracking type system:
  - `UsageEvent` interface + `BaseUsageEvent` base class (with `userKey` and `userAddedData`)
  - `FeatureHubUsageValue` interface + `UsageValue` class (holds feature id, key, value, type, environmentId)
  - `UsageEventWithFeature` — a single feature evaluation event with context attributes
  - `UsageFeaturesCollection` — a batch of feature values (e.g. on readiness)
  - `UsageFeaturesCollectionContext` — batch with context attributes
  - `UsageNamedFeaturesCollection` — named custom collection event
  - `UsagePlugin` interface + `DefaultUsagePlugin` abstract base
  - `UsageProvider` interface + `DefaultUsageProvider` class — factory for creating usage events; override `defaultUsageProvider` globally or per-repository to customise event construction
  - `useageConvertFunction` / `setUsageConvertFunction` — customise how feature values are serialised to strings
- **`usage/usage_adapter.ts`** — `UsageAdapter`: bridges the repository's usage stream to registered `UsagePlugin` instances. Created automatically by `EdgeFeatureHubConfig` when the repository is initialised.

### Platform-Specific Polling

The `PollingBase` class in core uses the **Fetch API** (available in both browser and modern Node). However, each platform provides its own concrete `PollingService` implementation via a static `pollingClientProvider`:

- Browser (`packages/js/src/polling_sdk.ts`): `BrowserPollingService`
- Node (`packages/node/src/polling_sdk.ts`): `NodejsPollingService` (adds node-specific crypto for hashing)

### Three Connection Modes

Set on `EdgeFeatureHubConfig` before calling `.init()` or `.build()`:

- **`config.streaming()`** — SSE long-lived connection
- **`config.restActive(intervalMs)`** — Polls at fixed interval regardless of usage (current default for both platforms)
- **`config.restPassive(cacheMs)`** — Only polls after cache expires AND a feature is evaluated

The default edge type is `REST_ACTIVE` (set in `defaultEdgeTypeProviderConfig` in `edge_featurehub_config.ts`). Platform packages may override this default.

### Client vs Server Evaluated Keys

API keys containing `*` are **client-evaluated** (all feature rules sent to the client). Keys without `*` are **server-evaluated** (server computes which variant applies per request context). The `EdgeFeatureHubConfig` detects this automatically from the key format.

### Usage Tracking System

Usage events flow as follows:

1. Feature evaluation in `BaseClientContext.used()` → creates a `UsageEventWithFeature` via `UsageProvider`
2. Event is passed to `InternalFeatureRepository.recordUsageEvent()` → fans out to all registered `UsageEventListener` streams
3. `UsageAdapter` (created by `EdgeFeatureHubConfig`) registers one such stream and forwards events to all registered `UsagePlugin` instances

Register a plugin with: `fhConfig.addUsagePlugin(myPlugin)`. Implement `UsagePlugin` or extend `DefaultUsagePlugin`.

### Usage Tracking Plugins (`plugins/usage/`)

Two reference implementations:

- `featurehub-usage-segment/` — Twilio Segment integration
- `featurehub-usage-opentelemetry/` — OpenTelemetry integration

### Browser Interceptor Plugin (`plugins/featurehub-browser-interceptor/`)

Provides `LocalSessionInterceptor` — a `FeatureStateValueInterceptor` that stores per-key overrides in browser `sessionStorage`. Formerly named `featurehub-baggage-userstate`.

### React SDK (`packages/react/src/`)

- `components/FeatureHub.tsx` — Context provider component
- `hooks/useFeature.ts`, `useFeatureHub.ts`, `useFeatureHubClient.ts` — React hooks for consuming features reactively

### TypeScript Configuration

All packages use strict TypeScript via `packages/tsconfig/base.json` which extends `@tsconfig/strictest`. Key strictness settings: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. Packages build with **tsup** (bundles to both ESM `.js` and CJS `.cjs`).

### Testing

- Test framework: **Vitest** with sinon for mocks/stubs
- Tests live in `src/__tests__/` within each package
- The `packages/js/__tests__/polling_sdk.test.ts` tests browser-specific polling; `packages/core/__tests__/` tests core logic
- Integration/E2E tests use **Cucumber/Gherkin** in `examples/todo-server-tests/`

### Linting

ESLint flat config at `eslint.config.ts`. Rules:

- `simple-import-sort` enforces sorted imports
- `@typescript-eslint/no-explicit-any` is **off** (any is allowed)
- `@typescript-eslint/no-non-null-assertion` is **off**
- Unused vars prefixed with `_` are allowed
- `plugins/**` is excluded from linting (TODO marker in config)

in each of the projects, to run formatting use `prettier . --write` and for linting
use `eslint --fix .`. Use this after each code change in each project that has changed.
