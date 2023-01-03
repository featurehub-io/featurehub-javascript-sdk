# FeatureHub React SDK

The FeatureHub React SDK currently provides three main things:

1. `FeatureHub` React component
2. `useFeatureHubClient` React hook
3. `useFeature` convenience React hook

## General Usage

Configuring `FeatureHub` for your React app is very straight forward.

```typescript
// App.tsx
import { FeatureHub } from "featurehub-react-sdk"

function AppContainer() {
  return (
    <FeatureHub url="..." apiKey="...">
      <App />
    </FeatureHub>
  )
}
```

The `url` and `apiKey` props are required as per FeatureHub configuration requirements. By doing the above, you are injecting the `FeatureHub` client into your React application tree (via React Context) which then allows you to use any of the additionally provided React hooks (`useFeatureHubClient` and `useFeature`) anywhere within your child React components.

## Hooks

### useFeatureHubClient

```typescript
// Navbar.tsx
import { useFeatureHubClient } from "featurehub-react-sdk"

// This NavBar component should be within some parent wrapped by the top-level <FeatureHub> component
function NavBar() {
  // Returns the FeatureHub client context
  const client = useFeatureHubClient();

  return (
    <nav>
      ...
    </nav>
  )
}
```

If for some reason you require access to the underlying FeatureHub client context, you can do so via this hook.

### useFeature<T<T>>

```typescript
// Navbar.tsx
import { useFeature } from "featurehub-react-sdk"

// This NavBar component should be within some parent wrapped by the top-level <FeatureHub> component
function NavBar() {
  const showNewNavTab = useFeature("new_nav_tab");

  return (
    <nav>
      {showNewNavTab ? <a>New Nav</a> : null}
    </nav>
  )
}
```

The `useFeature` is a very simple convenience hook that allows you to subscribe to a feature key defined within FeatureHub and fetch its value. All it does is subscribe to the key on component mount and unsubscribes when the component unmounts from view.

The implementation of `useFeature` leverages TypeScript generics (default is `boolean`) which allows you to set the value type you would expect given a feature key. So to return a non-binary type like `string` / `number` or a complex object type, simply pass that information in as part of the invocation.

- `const someStr = useFeature<string>("key")`
- `const someNum = useFeature<number>("key")`
- `const someObj = useFeature<CustomType>("key")`

## Bundling

We use [tsup](https://tsup.egoist.dev/#usage) to bundle this SDK.
