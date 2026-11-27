---
"featurehub-react-sdk": patch
"featurehub-solid-sdk": patch
---

A `pollInterval` prop under 5 seconds (other than 0) is logged and the default of 60 seconds used, as the browser SDK's `featurehub-interval` meta tag is, instead of throwing while the component renders.
