---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-react-sdk": minor
"featurehub-solid-sdk": minor
---

Extra headers for FeatureHub Edge, for an API gateway, a proxy, extra authentication or tracing: `fhConfig.headers({...})`, or a function called for each request so a value such as a short-lived token stays current. They are sent with every poll and every streaming connection and reconnection. The SDK's own protocol headers (`x-featurehub`, `If-None-Match`, `Last-Event-ID`) always win over a header of the same name, in any case. A browser's `EventSource` cannot send headers, so in a browser they are only sent when polling, and a warning is logged if they are configured for streaming. The React and Solid `FeatureHub` components take a `headers` prop.
