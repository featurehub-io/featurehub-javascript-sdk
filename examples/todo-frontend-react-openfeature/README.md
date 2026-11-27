# Todo frontend with OpenFeature (React)

A React todo app that reads its features through [OpenFeature](https://openfeature.dev): OpenFeature's React SDK (`@openfeature/react-sdk`) with the FeatureHub web provider (`featurehub-openfeature-web-sdk`). It uses no FeatureHub SDK API of its own. Its todos come from the OpenFeature todo backend ([`todo-backend-openfeature`](../todo-backend-openfeature)), so OpenFeature evaluates features on both sides:

- **in the browser**, `SUBMIT_COLOR_BUTTON` colours the Add button. It is evaluated locally by the provider for the current user.
- **in the backend**, `FEATURE_TITLE_TO_UPPERCASE`, `FEATURE_STRING`, `FEATURE_NUMBER` and `FEATURE_JSON` change the todos' titles. The backend evaluates them for the user in the request's URL.

It shows:

- registering the provider with an initial evaluation context (`OpenFeature.setProvider(provider, context)`), and `<OpenFeatureProvider suspendUntilReady>` with `<Suspense>` to wait for the first features;
- reading a flag with `useStringFlagDetails`, which re-renders when the feature changes in FeatureHub, and shows the evaluation's reason and variant (the id of the FeatureHub strategy that matched);
- changing the user with `useContextMutator`: every flag is re-evaluated in the browser, without asking FeatureHub again;
- recording `todo-add` and `todo-remove` with `useTrack`, as FeatureHub named usage events.
- keeping the features in the browser's local storage with `featurehub-store-localstorage`, attached through the provider's `configFactory`.

## Features

Create these in FeatureHub:

| Feature                      | Type    | Where   | Effect                                               |
| ---------------------------- | ------- | ------- | ---------------------------------------------------- |
| `SUBMIT_COLOR_BUTTON`        | string  | browser | the colour of the Add button (`green`, `orange`...)  |
| `FEATURE_TITLE_TO_UPPERCASE` | boolean | backend | upper-cases every title when on                      |
| `FEATURE_STRING`             | string  | backend | a todo titled `buy` becomes `buy <value>`            |
| `FEATURE_NUMBER`             | number  | backend | a todo titled `pay` becomes `pay <value>`            |
| `FEATURE_JSON`               | JSON    | backend | a todo titled `find` becomes `find <value of "foo">` |

Both sides use the same context: the user as the targeting key (FeatureHub's user key), with the country `new_zealand`, the device `browser` and the platform `macos`. Add a rollout strategy to `SUBMIT_COLOR_BUTTON` for one user (a user key equal to `bob`, say). Then switch between the users in the app, and the button changes colour.

## Running

The provider needs a **client-evaluated** API key (it contains `*`): the browser gets every feature with its rollout strategies and evaluates them itself. You can use the same key for the backend.

Start the backend (see [its README](../todo-backend-openfeature/README.md)):

```bash
cd ../todo-backend-openfeature
export FEATUREHUB_EDGE_URL=http://localhost:8085/
export FEATUREHUB_CLIENT_API_KEY=<your client-evaluated API key>
pnpm install && pnpm run start
```

Then put the app's settings in `.env.local` here, which overrides `.env` and is not committed:

```bash
VITE_FEATUREHUB_EDGE_URL=http://localhost:8085
VITE_FEATUREHUB_API_KEY=<your client-evaluated API key>
```

And start it:

```bash
pnpm install
pnpm run start
```

The app is at http://localhost:3000.

| Setting                         | Default                 |                                                 |
| ------------------------------- | ----------------------- | ----------------------------------------------- |
| `VITE_FEATUREHUB_EDGE_URL`      | `http://localhost:8085` | FeatureHub Edge, as the browser reaches it      |
| `VITE_FEATUREHUB_API_KEY`       |                         | a client-evaluated API key                      |
| `VITE_FEATUREHUB_POLL_INTERVAL` | `5000`                  | how often to check FeatureHub for changes (ms)  |
| `VITE_TODO_SERVER_URL`          | `http://localhost:8099` | the todo backend                                |

The app polls FeatureHub, so a change you make there shows within the interval. The provider's own default in a browser is passive: it only checks FeatureHub when a flag is evaluated after the interval has passed. That saves requests, but a change would only show at your next action in the app. `transport: "streaming"` gets changes at once instead.

## Local storage

The provider runs on a FeatureHub config. The app builds that config itself with `configFactory`, so it can attach a `LocalSessionStore` (from `featurehub-store-localstorage`) to it:

```ts
new FeatureHubWebProvider({
  host,
  apiKey,
  pollIntervalMs,
  configFactory: ({ host, apiKey }) => {
    const config = new EdgeFeatureHubConfig(host!, apiKey!);
    new LocalSessionStore(config, window.localStorage);
    return config;
  },
});
```

The store saves every set of features FeatureHub sends, and loads them as the app starts. On a later visit the provider is ready at once, with the features from the last visit, and updates them when FeatureHub answers. The store uses session storage, which lasts only as long as the tab, unless it is given another storage, as it is here. The provider applies its transport options to the config and starts it, so `configFactory` must not call `init()`.

If FeatureHub cannot be reached and nothing is stored, the provider gives up after 10 seconds (`waitForReadyMs`). The app then runs with each flag's default: a blue button.

## How it differs from the FeatureHub SDK example

| FeatureHub SDK ([`todo-frontend-react-typescript`](../todo-frontend-react-typescript)) | This example                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `FeatureHub.config` from `<meta>` tags                                                 | `new FeatureHubWebProvider({ host, apiKey, pollIntervalMs })`, from Vite's `.env`     |
| `addReadinessListener`, and a "waiting" render until it fires                          | `<OpenFeatureProvider suspendUntilReady>` and a `<Suspense>` fallback                 |
| `FeatureHub.feature(key).addListener(...)` and `setState`                              | `useStringFlagDetails(key, default)`, which re-renders on a change                    |
| `FeatureHub.context.userKey(user).build()`                                             | `setContext({ targetingKey: user, ... })` from `useContextMutator`                    |
| `FeatureHub.context.recordNamedUsage(name, params)`                                    | `track(name, params)` from `useTrack`                                                 |
| `new LocalSessionStore(FeatureHub.config)`                                             | `new LocalSessionStore(config, window.localStorage)` in `configFactory`               |
