#### 1.5.0

- extract all shared code into `core` module, leaving only browser specific logic
  in `client`. `client` now depends on `core` and `node` now depends on `core` rather
  than `client` so there are no window objects.
- swap to `fetch` as the standard for all HTTP/s communication across the board
- using browser or node native `crypto` library to generate sha256s
- swapped to pnpm to generate more secure packages
- updates to react and solid sdk's to recognize lazy initialisation
- fixed issue with complex strategies with percentage evaluation
- address issue with local storage caching of non-generic attributes

#### 1.4.0

- polling functionality changed to ensure double polling doesn't happen when the context is changed, but as node
  relies on client-sdk, we have to bump the versions.

#### 1.3.3

- listeners were not being fired when added to contexts that matched strategies. [bugfix](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/196)
- all the getX methods on the Context now have defaults, so you can say fhContext.getFlag("feature", false) and if it isn't set or doesn't exist, it will return false. This is an optional field so it doesn't break existing code. (feature)
- set murmur3 hash seed value to 0 to be consistent with all SDK apis [bugfix](https://github.com/featurehub-io/featurehub/issues/1109).

#### 1.3.2

- Delete feature returns version zero which was being prevented from action by 1.3.1

#### 1.3.1

- Edge case where a feature is retired and then unretired immediately, this _can_ cause the feature to stay deleted.

#### 1.3.0

- This surfaces a fully statically typed API for Typescript clients who enforce it. Of particular interest
  is the places where `undefined` can be returned.
- Uses the featurehub-javascript-client-sdk v 1.3.0

#### 1.2.0

- update dependency to use featurehub-javascript-client-sdk v 1.2.0
- documentation update

#### 1.1.7

- Support multiple attribute values per custom evaluated key.
- Support a .value method on all SDKs (contributed by Daniel Sanchez (@thedanchez))
- fix an issue with Fastly support (contextSha=0 query parameter). This is the minimum SDK version required for Fastly support.

#### 1.1.6

- Resolve issue with cache control header [Github issues](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/23)
- Change to interfaces instead of classes for models, and match the OpenAPI current definition
- Add support for deregistering feature and readiness listeners (ready for React SDK)
- Deprecate the readyness listener for a readiness listener
- Add support for stale environments [GitHub PR](https://github.com/featurehub-io/featurehub-javascript-sdk/pull/78)

#### 1.1.5

- Support for adding custom headers [GitHub issues](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/32), [GitHub PR](https://github.com/featurehub-io/featurehub-javascript-sdk/pull/44)
- Fix bug in catch and release mode when feature value would not update if another feature state was changed [GitHub PR](https://github.com/featurehub-io/featurehub-javascript-sdk/pull/70)

#### 1.1.4

- Bump eventsource dependency (critical security alert)

#### 1.1.3

- Fix a bug when deleted features are not picked up on polling SDK requests [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/20)

- Fix to allow Cache Control headers to be set on Edge and be honoured by a client (only relevant for FeatureHub versions >= 1.5.7) [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/17)

#### 1.1.2

- Bump dependency version

#### 1.1.1

- Provided additional getters to get feature values and properties [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/4). If using Typescript, please upgrade your project to typescript v4.3+
- Updated links to examples and documentation as the SDK has been split into a separate repository

#### 1.0.10

- Fix a bug related to Catch & Release mode [GitHub issue](https://github.com/featurehub-io/featurehub/issues/648)

#### 1.0.9

- Enabled e-tag support

#### 1.0.8

- Decrease sdk size by replacing ip6addr.ts with netmask package.

#### 1.0.7

- Support static flag evaluation [GitHub issue](https://github.com/featurehub-io/featurehub/issues/497)
- Decrease sdk size by replacing semver with semver-compare [GitHub issue](https://github.com/featurehub-io/featurehub/issues/498)

#### 1.0.6

- Fix to the SSE client to prevent excess of connections to the server.

#### 1.0.5

- Fix an issue with the polling client

#### 1.0.4

- Documentation updates

#### 1.0.3

- Bugfix: Edge server urls passed to the config that include '/feature' should be processed correctly

#### 1.0.2

- Documentation updates

#### 1.0.1

- Symlink readme file from featurehub-javascript-client-sdk

#### 1.0.0

- Move from featurehub-eventsource-sdk + featurehub-repository, split out nodejs into its own repository to allow
  Angular & Vue to use this library.
