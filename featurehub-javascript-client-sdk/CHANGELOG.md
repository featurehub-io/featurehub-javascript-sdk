#### 1.3.2
- Delete feature returns version zero which was being prevented from action by 1.3.1
#### 1.3.1
- Edge case where a feature is retired and then unretired immediately, this _can_ cause the feature to stay deleted.
#### 1.3.0
- This surfaces a fully statically typed API for Typescript clients who enforce it. Of particular interest
is the places where `undefined` can be returned. 
#### 1.2.0
- Support for localstorage in a browser to cache the features
- EdgeFeatureHubConfig will now hold onto only a single context for server evaluated keys. Once created
it will always give out the same one.
- EdgeFeatureHubConfig ensures there is only one connection to the server and only one set of polling will
happen that is under its control. This ensures the React SDK for example will only have one active poll.
- removed the alternative log silencing method
- added meta-tag support for browsers and a new FeatureHub object to access them
- updated documentation
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
- Bump dependencies
- Fix bug in percentage calculation where it did not use value from context if specifying your own percentage attributes
#### 1.1.3
- Fix a bug when deleted features are not picked up on polling SDK requests [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/20)

- Fix to allow Cache Control headers to be set on Edge and be honoured by a client (only relevant for FeatureHub versions >= 1.5.7) [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/17)

#### 1.1.2
- Fix a bug related to Catch & Release mode [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/9)
#### 1.1.1
- Provided additional getters to get feature values and properties [GitHub issue](https://github.com/featurehub-io/featurehub-javascript-sdk/issues/4). If using Typescript, please upgrade your project to typescript v4.3+
- Updated links to examples and documentation as the SDK has been split into a separate repository
#### 1.0.12
- Reverted the change from 1.0.11 as that forced a new version (4.3+) of Typescript for Typescript users. This version
  remains compatible with Typescript 3.9.x
#### 1.0.11
- Provided additional getters to get feature values and properties [GitHub PR](https://github.com/featurehub-io/featurehub/pull/656/)
#### 1.0.10
- Fix a bug related to Catch & Release mode [GitHub issue](https://github.com/featurehub-io/featurehub/issues/648)
#### 1.0.9
- Enabled e-tag support
#### 1.0.8
- Enabled Tree Shaking [GitHub issue](https://github.com/featurehub-io/featurehub/issues/509)
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
- Fix regression bug with strategies not being passed correctly and thus not serving the expected feature values
#### 1.0.0
- Move from featurehub-eventsource-sdk + featurehub-repository, split out nodejs into its own repository to allow
  Angular & Vue to use this library.

