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

- **`edge_featurehub_config.ts`** — `EdgeFeatureHubConfig`: the main entry point for users. Manages connection lifecycle, context creation, and the `EdgeType` (STREAMING / REST_ACTIVE / REST_PASSIVE).
- **`feature_hub_config.ts`** — `FeatureHubConfig` interface + `FHLog` logging class + `EdgeType` enum.
- **`client_feature_repository.ts`** — `ClientFeatureRepository`: holds all feature states, processes updates, fires events.
- **`context_impl.ts`** — `ClientEvalFeatureContext` (client-side key) and `ServerEvalFeatureContext` (server-side key): the per-user evaluation context.
- **`network/polling_sdk.ts`** — `PollingBase` (abstract, platform-agnostic polling logic) + `FeatureHubPollingClient` (orchestrates polling, handles active/passive modes and cache expiry).
- **`network/featurehub_eventsource.ts`** — SSE streaming client.
- **`network/index.ts`** — `FeatureHubNetwork.defaultEdgeServiceSupplier` chooses the right transport based on `EdgeType`.
- **`usage/usage.ts`** — Usage tracking types: `UsagePlugin` (abstract base), `UsageEvent`, `UsageEventWithFeature`, `UsageFeaturesCollection`.
- **`usage/usage_adapter.ts`** — `UsageAdapter`: bridges the repository's usage stream to registered `UsagePlugin` instances.

### Platform-Specific Polling

The `PollingBase` class in core uses the **Fetch API** (available in both browser and modern Node). However, each platform provides its own concrete `PollingService` implementation via a static `pollingClientProvider`:

- Browser (`packages/js/src/polling_sdk.ts`): `BrowserPollingService`
- Node (`packages/node/src/polling_sdk.ts`): `NodejsPollingService` (adds node-specific crypto for hashing)

### Three Connection Modes

Set on `EdgeFeatureHubConfig` before calling `.init()` or `.build()`:

- **`config.streaming()`** — SSE (default for Node)
- **`config.restActive(intervalMs)`** — Polls at fixed interval regardless of usage (default for browser)
- **`config.restPassive(cacheMs)`** — Only polls after cache expires AND a feature is evaluated (new in v2)

### Client vs Server Evaluated Keys

API keys containing `*` are **client-evaluated** (all feature rules sent to the client). Keys without `*` are **server-evaluated** (server computes which variant applies per request context). The `EdgeFeatureHubConfig` detects this automatically from the key format.

### Usage Tracking Plugins (`plugins/usage/`)

Two reference implementations:

- `featurehub-usage-segment/` — Twilio Segment integration
- `featurehub-usage-opentelemetry/` — OpenTelemetry integration

Register a plugin with: `fhConfig.addUsagePlugin(myPlugin)`.

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
