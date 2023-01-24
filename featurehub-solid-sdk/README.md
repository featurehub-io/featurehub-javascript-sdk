# FeatureHub Solid SDK

[![Build featurehub-solid-sdk](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/solid-sdk-build.yml/badge.svg)](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/solid-sdk-build.yml)
[![npm version](https://badge.fury.io/js/featurehub-solid-sdk.svg)](https://badge.fury.io/js/featurehub-solid-sdk)

## Installation

Both `featurehub-javascript-client-sdk` and `solid-js` are peer dependencies of `featurehub-solid-sdk` and need to be installed alongside it.

```code
npm install featurehub-solid-sdk featurehub-javascript-client-sdk solid-js
// or
yarn install featurehub-solid-sdk featurehub-javascript-client-sdk solid-js
// or
pnpm install featurehub-solid-sdk featurehub-javascript-client-sdk solid-js
```

## General Usage

The FeatureHub Solid SDK provides the following:

1. `FeatureHub` Solid top-level component to wrap your application with
2. `useFeature` Solid hook to subscribe to feature keys within Solid components
3. `useFeatureHub` Solid hook providing access to the FeatureHub config and client objects

Configuring `FeatureHub` for your Solid app is very straight forward.

```typescript
// App.tsx
import { FeatureHub } from "featurehub-solid-sdk";

function AppContainer() {
  return (
    <FeatureHub url="..." apiKey="...">
      <App />
    </FeatureHub>
  );
}
```

The `url` and `apiKey` props are required as per FeatureHub configuration requirements. By doing the above, you are injecting the `FeatureHub` client into your Solid application tree (via Solid Context) which then allows you to use any of the additionally provided hooks (`useFeatureHub` and `useFeature`) anywhere within your child Solid components.

## Hooks

### useFeature<T<T>>

```typescript
// Navbar.tsx
import { useFeature } from "featurehub-solid-sdk";

// This NavBar component should be within some parent wrapped by the top-level <FeatureHub> component
function NavBar() {
  const showNewNavTab = useFeature("new_nav_tab");

  return <nav>{showNewNavTab() ? <a>New Nav</a> : null}</nav>;
}
```

The `useFeature` is a very simple convenience hook that allows you to subscribe to a feature key defined within FeatureHub and fetch its value. All it does is subscribe to the key on component mount and unsubscribes when the component unmounts from view.

The implementation of `useFeature` leverages TypeScript generics (default is `boolean`) which allows you to set the value type you would expect given a feature key. So to return a non-binary type like `string` / `number` or a complex object type, simply pass that information in as part of the invocation.

- `const someStr = useFeature<string>("key")`
- `const someNum = useFeature<number>("key")`
- `const someObj = useFeature<CustomType>("key")`

### useFeatureHub

```typescript
// Navbar.tsx
import { useFeatureHub } from "featurehub-solid-sdk";

// This NavBar component should be within some parent wrapped by the top-level <FeatureHub> component
function NavBar() {
  // Returns the FeatureHub config and client objects
  const { config, client } = useFeatureHub();

  return <nav>...</nav>;
}
```

If for some reason `useFeature` is not sufficient and you require access to the underlying FeatureHub config or client context objects, you can do so via this hook.

## Bundling

We use [tsup](https://tsup.egoist.dev/#usage) to bundle this SDK.
