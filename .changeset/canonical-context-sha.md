---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Build the `x-featurehub` header and `contextSha` exactly as the FeatureHub protocol specifies, so every SDK sends the same values for the same context:

- attribute keys are now URL-encoded as well as values, and attributes with no value are left out instead of being sent as `key=`
- `contextSha` is the SHA-256 of the header as 64 lowercase hex characters (it was base64url), or `0` when there is no header
- streaming connections now send `contextSha` too, and the browser's `xfeaturehub` query parameter is encoded with `encodeURIComponent`
- polling clears its ETag when the context changes, and no longer keeps the ETag of a response whose context changed while it was in flight, or whose body could not be decoded

Edge does not read `contextSha`, so feature evaluation is unchanged; a CDN in front of Edge will see each context's cache key change once.
