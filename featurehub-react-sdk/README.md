# FeatureHub React SDK

## Installation

Both `featurehub-javascript-client-sdk` and `react` are peer dependencies of `featurehub-react-sdk` and need to be installed alongside it.

```code
npm install featurehub-react-sdk featurehub-javascript-client-sdk react
// or
yarn install featurehub-react-sdk featurehub-javascript-client-sdk react
// or
pnpm install featurehub-react-sdk featurehub-javascript-client-sdk react
```

## General Usage

The FeatureHub React SDK provides the following:

1. `FeatureHub` React top-level component to wrap your application with
2. `useFeature` React hook to subscribe to feature keys within React components
3. `useFeatureHub` React hook providing access to the FeatureHub config and client context objects

Configuring `FeatureHub` for your React app is very straight forward.

```typescript
// App.tsx
import { FeatureHub } from "featurehub-react-sdk";

function AppContainer() {
  return (
    <FeatureHub url="..." apiKey="...">
      <App />
    </FeatureHub>
  );
}
```

The `url` and `apiKey` props are required as per FeatureHub configuration requirements. By doing the above, you are injecting the `FeatureHub` client into your React application tree (via React Context) which then allows you to use any of the additionally provided React hooks (`useFeature` and `useFeatureHub`) anywhere within your child React components.

## Hooks

Reminder that in order to use the following hooks, your `<App />` component must be wrapped by the provided `<FeatureHub>` component.

### useFeature<T<T>>

```typescript
// Navbar.tsx
import { useFeature } from "featurehub-react-sdk";

// This NavBar component should be within some parent wrapped by the top-level <FeatureHub> component
function NavBar() {
  const showNewNavTab = useFeature("new_nav_tab");

  return <nav>{showNewNavTab ? <a>New Nav</a> : null}</nav>;
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
import { useFeatureHub } from "featurehub-react-sdk";

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
