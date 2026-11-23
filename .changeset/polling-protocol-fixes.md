---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Polling and streaming fixes, following the FeatureHub protocol:

- polling now stops for good on any 4xx (a bad API key was polled forever, as the 400/404 check never matched the error it was given), and the repository is told the connection failed
- a context change while a poll is in flight now fetches for the new context, rather than being answered by the old context's response
- polling no longer stays busy for ever when the browser's local cache satisfies a poll, which stopped every later poll
- a poll that fails with no further poll scheduled (an interval of 0, or passive polling) now rejects, rather than never settling
- passive polling with an interval of 0 polls once, rather than on every evaluation
- a Cache-Control max-age is read only from a 200 or 236, is raised to at least 5 seconds, and never starts polling when the interval is 0
- a response that is not an array of environments is rejected (and retried) instead of being applied; absent or null features mean none, and an empty array of environments is an empty set of features rather than a failure
- a streaming `edge.stale` config event, whatever its value, closes the stream for good; it was read as a number of seconds to wait before reconnecting
