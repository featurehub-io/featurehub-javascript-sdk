import "./index.css";

import { OpenFeature, OpenFeatureProvider } from "@openfeature/react-sdk";
import { EdgeFeatureHubConfig } from "featurehub-javascript-client-sdk";
import { FeatureHubWebProvider } from "featurehub-openfeature-web-sdk";
import { LocalSessionStore } from "featurehub-store-localstorage";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import App, { userContext, USERS } from "./App";

const edgeUrl = import.meta.env["VITE_FEATUREHUB_EDGE_URL"] as string | undefined;
const apiKey = import.meta.env["VITE_FEATUREHUB_API_KEY"] as string | undefined;
const pollInterval = Number(import.meta.env["VITE_FEATUREHUB_POLL_INTERVAL"] || "5000");

const root = createRoot(document.getElementById("root")!);

if (!edgeUrl || !apiKey) {
  root.render(
    <div className="App">
      <h1>FeatureHub is not configured</h1>
      <p>
        Set <code>VITE_FEATUREHUB_EDGE_URL</code> and <code>VITE_FEATUREHUB_API_KEY</code> (a
        client-evaluated key, containing <code>*</code>) in <code>.env.local</code>, and restart.
      </p>
    </div>,
  );
} else {
  // The provider starts with this user's context, so the very first evaluations are for them. Features are
  // evaluated in the browser: the key is client-evaluated, so the provider holds every feature and its
  // rollout strategies, and a context change is applied locally without asking FeatureHub again.
  // It polls FeatureHub every pollInterval ms. The provider's default for browsers is passive (it only checks
  // when a flag is evaluated after the interval), which would not show changes as they are made.
  OpenFeature.setProvider(
    new FeatureHubWebProvider({
      host: edgeUrl,
      apiKey,
      pollIntervalMs: pollInterval,
      // the provider runs on a FeatureHub config: building it ourselves lets us attach FeatureHub's extras.
      // The provider still sets its transport and starts it, so it is not initialised here.
      configFactory: ({ host, apiKey }) => {
        const config = new EdgeFeatureHubConfig(host!, apiKey!);
        // Keeps the features FeatureHub sends in the browser's local storage, and loads them at start: on
        // the next visit the app is ready at once, with the last features, before FeatureHub answers (and
        // even if it cannot be reached). The store uses session storage unless it is given another.
        new LocalSessionStore(config, window.localStorage);
        return config;
      },
    }),
    userContext(USERS[0]),
  );

  root.render(
    <StrictMode>
      {/* suspendUntilReady: components that read flags wait (showing the fallback) for the first features */}
      <OpenFeatureProvider suspendUntilReady>
        <Suspense fallback={<h1 className="App">Waiting for initial features.</h1>}>
          <App />
        </Suspense>
      </OpenFeatureProvider>
    </StrictMode>,
  );
}
