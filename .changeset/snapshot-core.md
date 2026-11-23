---
"featurehub-javascript-core-sdk": minor
---

Core support for the feature snapshot protocol: the repository's `featuresSha` (the SHA of its features' ids and versions, kept current on every change), `featureStates()` (copies of the features held), and `loadFeatureSnapshot(data)` (loads a snapshot, its JSON or a bare array of features as a full set, leaving the repository unchanged if the data is not a snapshot). `decodeFeatureSnapshot`, `featuresSha` and `featureSnapshotEtag` are exported, and edge services are now given the context's attributes on a context change as well as its `x-featurehub` header.
