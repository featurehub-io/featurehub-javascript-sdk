---
"featurehub-javascript-node-sdk": minor
---

The Node SDK reads the rest of the FeatureHub environment variables, each only when your code does not set the same thing:

- `FEATUREHUB_EDGE_URL`, and `FEATUREHUB_CLIENT_API_KEY` (or else `FEATUREHUB_SERVER_API_KEY`), for an `EdgeFeatureHubConfig` given no URL or API key
- `FEATUREHUB_POLLING_REQ_TIMEOUT`: how long a polling request may take
- `FEATUREHUB_SSE_CONNECT_TIMEOUT` and `FEATUREHUB_SSE_READ_TIMEOUT`: how long opening a stream may take, and how long an open stream may go without data, before it is reconnected (a read timeout of 5 minutes or less logs a warning, as Edge may be silent that long)
- `FEATUREHUB_SSE_INITIAL_RETRY_DELAY`, `FEATUREHUB_SSE_MAX_RETRY_DELAY` and `FEATUREHUB_SSE_BACKOFF_MULTIPLIER`: the reconnection backoff

An invalid value is ignored with a warning, and the default applies.
