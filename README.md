**Client SDK**

[![Build featurehub-javascript-client-sdk](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-client-build.yml/badge.svg)](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-client-build.yml)
[![npm version](https://badge.fury.io/js/featurehub-javascript-client-sdk.svg)](https://badge.fury.io/js/featurehub-javascript-client-sdk)

**Node SDK**

[![Build featurehub-javascript-node-sdk](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-node-build.yml/badge.svg)](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-node-build.yml)
[![npm version](https://badge.fury.io/js/featurehub-javascript-node-sdk.svg)](https://badge.fury.io/js/featurehub-javascript-node-sdk)

| Documentation                                          | Changelog                                                                                                                                                                                                                                                                              | Example Quick links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FeatureHub platform docs](https://docs.featurehub.io) | [Changelog Client SDK](https://github.com/featurehub-io/featurehub-javascript-sdk/blob/main/featurehub-javascript-client-sdk/CHANGELOG.md) <br> [Changelog Node SDK](https://github.com/featurehub-io/featurehub-javascript-sdk/blob/main/featurehub-javascript-node-sdk/CHANGELOG.md) | [React example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript) <br> [Node example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-backend-typescript) <br> [Test automation example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-server-tests) <br> [React Catch & Release mode example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript-catch-and-release) <br> [React Feature Overrides example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript-feature-override) |

# Javascript/Typescript SDK for FeatureHub

## Overview

Welcome to the Javascript/Typescript SDK implementation for [FeatureHub.io](https://featurehub.io) - Open source Feature flags management, A/B testing and remote configuration platform.

This documentation covers both [featurehub-javascript-node-sdk](https://www.npmjs.com/featurehub-javascript-node-sdk) and [featurehub-javascript-client-sdk](https://www.npmjs.com/featurehub-javascript-client-sdk) and explains how you can use the FeatureHub SDK in Javascript or Typescript for applications like Node.js
backend servers, Web front-ends (e.g. Vanilla, React, Angular) or Mobile apps (React Native, Ionic, etc.).

To control the feature flags from the FeatureHub Admin console, either use FeatureHub SaaS cloud version [demo](https://app.featurehub.io) or install the app using our guide [here](https://docs.featurehub.io/featurehub/latest/installation.html)

## Contributing

Interested in contributing to the FeatureHub JavaScript SDK? Please see our [Contributing Guide](CONTRIBUTING.md) for development setup, testing, and contribution guidelines.

## SDK installation

There are four different packages, which you can install using the package manager of your choice (we use pnpm):

- `featurehub-javascript-client-sdk` - this installs the basic Browser compatible SDK. All Browser based frameworks are compatible with this library. It ships in both CommonJS and ES Modules format.
- `featurehub-javascript-react-sdk` - this installs the `client` SDK + the React compatible extra layer on top.
- `featurehub-javascript-solid-sdk` - this installs the `client` SDK + the SolidJS compatible extra layer on top.
- `featurehub-javascript-node-sdk` - if you are running a NodeJS compatible (node, bun, etc) server side application, this is the library you would choose.

All of these libraries use the `core` sdk which provides all common functionality, but the `client` and `node` adapt to their own environments.

## Changes from the 1.x Version

- There are now 3 ways to use the client, SSE ("near realtime"), Active REST (you set a polling interval and it polls at that interval regardless), and Passive REST (you set a polling interval and only if a feature is evaluated at or after that interval is a request for a data refresh made). Passive REST is new.
- The Client Context (the per user evaluation context for features) is now essentially `Record<string,number|string|boolean|Array<number>|Array<string>|Array<boolean>`
  from being a `Record<string,string>`. The signature of the ClientContext has changed to match this.
- The API now has a Usage Tracking feature for feature evaluation, which is completely pluggable and able
  to collect information on individual evaluations as well as collections of feature updates and user's
  context while evaluating. A Twilio Segment plugin and OpenTelemetry plugin are provided as examples. This usage
  tracking is what is used to enable the Passive REST capability.

## Options to get feature updates

There are 3 ways to request for feature updates via this SDK:

- **FeatureHub Active REST polling client (GET request updates)**

  In this mode, updates to feature state are under your control but are regularly fetched (or only fetched once if you set your polling interval to 0). Regardless of what is going on with the user, the features will keep getting fetched at the interval you set. As feature updates are fairly rare and you may wish to see them as soon as possible within an interval, this is ideal for low cost serving and browser based applications.

- **FeatureHub Passive REST polling client (GET request updates)**
  In this mode, updates to feature state are set at a threshold, after which a poll will happen but only if the user is actively evaluating features. If no path in your application is taken where a feature is evaluated or the user has moved away from the application (a different browser tab, a different mobile
  application for example), then polling will stop until evaluation occurs again. You can trigger it yourself if you wish simply by making an API call when your application comes active.

- **SSE (Server Sent Events) realtime updates mechanism**

  In this mode, you will make a connection to the FeatureHub Edge server using the EventSource, and any updates to any features will come through to you in _near realtime_, automatically updating the feature values in the repository. This method is recommended for server (Node) applications. `featurehub-javascript-node-sdk` is configured to use SSE by default. If you decide to use SSE in the browser applications, there is a known issues in the browsers with Kaspersky antivirus potentially blocking SSE events. [GitHub issue](https://github.com/featurehub-io/featurehub/issues/296)

## Browser Quick Start

### Connecting to FeatureHub

There are 3 steps to connecting:

1. Copy FeatureHub API Key from the FeatureHub Admin Console
2. Create FeatureHub config
3. Request feature state

#### 1. API Key from the FeatureHub Admin Console

Find and copy your Server Eval API Key from the FeatureHub Admin Console on the API Keys page -
you will use this in your code to configure feature updates for your environments. _Server Side evaluation_ is more suitable when you are using an _insecure client_. (e.g. Browser or Mobile). This means your application is reflecting the actions of a single person.

It should look similar to this: `5e61fd62-d4ed-40e0-9cc1-cb3d809f6149/YDr1E4uQGA2Li54fQ0HpmSr2LMv9yHhwzxut2DRO`.

There are other variations of applications where you might want to use a key in a different way from above, we cover more on
this [in the main FeatureHub documentation](https://docs.featurehub.io/featurehub/latest/sdks.html#_client_and_server_api_keys)

#### 2. Create FeatureHub config:

In your page's HTML, add the following (replacing the urls and keys with your own server details):

```html
<meta name="featurehub-url" content="http://localhost:8085" />
<meta
  name="featurehub-apiKey"
  content="c320b6aa-3054-4505-92a5-c01682d47ec2/So1qQ4FOX2UM0Bpxs3r6TqjuDo0WjEIAeYO01dwa"
/>
<meta name="featurehub-interval" content="15000" />
```

The interval indicates the polling frequency in milliseconds, set to 15 seconds here. By default this uses Active REST polling. To use Passive REST instead (polling only when features are actually evaluated), add:

```html
<meta name="featurehub-client" content="passive" />
```

To use SSE real-time streaming instead of polling:

```html
<meta name="featurehub-client" content="streaming" />
```

It is normal and expected that your API key will be exposed to the end user in this case, as it is intended to be used in insecure environments.

```typescript
import { FeatureHub } from "featurehub-javascript-client-sdk";
```

The above code configured a server evaluated connection and immediately requests to connect and get the
features from the server. See below for why you might want to delay this.

#### 3. Request feature state

In a standard browser situation, there is a single active connection to the FeatureHub server.
You can ask for the feature state in your conditional code (we use a boolean flag here):

```typescript
if (FeatureHub.feature("FEATURE_KEY").enabled) {
}
```

There is always a possibility of a delay between loading the page and the initial state of the features loading. If your
conditional code executes before the features load (e.g. it has never loaded before or the cache we store of features in
`localStorage` hasn't loaded yet), you will get an "empty" feature - which will generally evaluate all boolean flags to disabled/false,
and all other types of flags to empty.

They may not exist, but you can _react_ to changes in feature state. If you wish parts of your page to render
when the feature repository gains state, you can listen for the event `addReadynessListener`:

```typescript
FeatureHub.config.addReadynessListener((_, firstTimeReady) => {
  if (firstTimeReady) {
    // its ready and its the first time it has been ready, so make appropriate screen changes
    const value = fhConfig.feature("FEATURE_STRING").str;
    console.log("Value is ", value);
  }
});
```

Alternatively, you can listen for updates in specific features.

```typescript
FeatureHub.feature("FEATURE_KEY").addListener((feature) => {
  if (feature.flag) {
    // perform some UI update
  }
});
```

You can listen to these events at any point, the state of the features doesn't need to be loaded yet.

# Quick Start for NodeJS

## Step 1: Getting an apiKey

Generally for a nodejs application (unless its a batch application) you would use a _client evaluated key_. _Client Side evaluation_ is intended for use in secure environments (such as microservices, e.g Node JS) and is intended for rapid client side evaluation, per request for example. This also means all of the feature flag targeting information comes down to the server application and it can make complex feature decisions locally.

## Step 2: Setting up your configuration

Set the location of your FeatureHub server, your API key and other global information via
environment variables:

```typescript
const fhConfig = new EdgeFeatureHubConfig(
  process.env.FEATUREHUB_EDGE_URL,
  process.env.FEATUREHUB_CLIENT_API_KEY,
).init();
```

In this case, we are creating a global connection and adding it to the startup of the application and telling it to kick off.

We recommend that for a server application, you include the _readyness_ of the FeatureHub connection in your health check, so
don't let the deployment orchestration (be it a FaaS, kubernetes, ECS, etc) let any traffic route to your server unless you
have a healthy connection to FeatureHub (just like you could with a database):

```typescript
server.get("/health/liveness", (req, res, next) => {
  if (fhConfig.readyness === Readyness.Ready) {
    // other checks also here
    res.status(200);
    res.send("ok");
  } else {
    res.send("not ready");
    res.status(500);
  }

  next();
});
```

### Adding middleware

To personalise the results for each person, FeatureHub uses _Contexts_ - in browser mode there is only one as a
browser represents a single user, but in your NodeJS server app, each request can represent a different person.
Your middleware is typically where you will create the per-request context and personalise it.

```typescript
import { FeatureHubConfig } from "./feature_hub_config";

export function userMiddleware(fhConfig: FeatureHubConfig) {
  return (req: any, res: any, next: any) => {
    const user = detectUser(req); // function to analyse the Bearer token and determine who the user is

    let fhClient = fhConfig.context();

    if (user) {
      fhClient.userKey(user.email);
      // add anything else relevant to the context
    }

    fhClient = fhClient.build().then(() => {
      req.featureContext = fhClient;

      next();
    });
  };
}
```

## Step 3: Using it in your application

In a GET method, determine which message to send:

```typescript
app.get("/", function (req, res) {
  if (req.featureContext.feature("FEATURE_KEY").enabled) {
    req.send("The feature is enabled");
  } else {
    res.send("The feature is disabled.");
  }
});
```

# Beyond the Quick Start:

In this section we cover a bundle of different variations for clients and servers.

### Does my existing code from 1.x work?

If you have browser code that uses the version earlier than 1.2.0, it still works largely the same and its unlikely you will need to change anything.
The biggest change we made in 1.2.+ is in the browser handling. The 99% use case for a browser is a single user, so
that means requests for a new context (`FeatureHub.config.newContext()` for example) always actually give
you back exactly the same context. And we reference count your requests as well, once your connection is open,
its open until all requests to create a new context also close them.

If you actually _want_ a second (or third, or forth) context in a browser, you can absolutely get one, you will
need to create one - a new `ServerEvalFeatureContext`.

### Can the browser initialize like the NodeJS example?

Yes, the `<meta>` tag headers are simply an easy way to initialise we introduced in the 1.2.0 version of the API.
Single Page Applications (SPA) may not have meta tags and may wish to control exactly how libraries and objects in libraries
are made available. As it is still a browser application, you will want to delay your initialization.

```typescript
const fhConfig = new EdgeFeatureHubConfig("<url>", "<key>"); // no .init()
const fhContext = fhConfig.newContext();
// ... fill in any extra detail in the context
await fhContext.build(); // the await is optional
```

If you want to ensure you can use the global `FeatureHub` class, then simply set it with:

```typescript
FeatureHub.set(fhConfig);
```

### What is meant by extra detail? How do I use the strategies attached to feature flags?

FeatureHub is able to provide user targeting - to support progressive rollouts, targeted rollouts and even
A/B testing. This will require you to pass ClientContext. When you create config and immediately initialize it, it doesn't contain any Client Context information, however you can customise this connection at any time and add the context:

Example to specify the languages  
and username of the person up front you can do this:

```typescript
const fhConfig = EdgeFeatureHubConfig.config(edgeUrl, apiKey);
fhConfig
  .newContext()
  .userKey("<some-user-key>")
  .attributeValues("languages", navigator.languages)
  .build();
```

This tells the SDK to hold onto those pieces of information and provide targeted evaluation
against them.

**Important Note** - you can change these at any time, just remember to add `.build()` on the end. You also do not require the `init()` because the `.build()` will do it for you.

### What is the deal with readyness?

Readyness indicates when the SDK has received state or failed to receive state. There is an event on the SDK called
`addReadynessListener`. You get two pieces of information, the readyness status and whether its the first time its been ready.
This is often the information you need to kick your UI into gear in some way.

```typescript
FeatureHub.config.addReadinessListener((readyness, firstTimeReady) => {
  if (firstTimeReady) {
    const color = FeatureHub.context.getString("SUBMIT_COLOR_BUTTON");
    this.setState({ todos: this.state.todos.changeColor(color) });
  }
});
```

If you are writing a server application, it would be typical to include the features being
available in a health check (as in the Quick Start). If your server is not able to get its features, it should not
receive traffic as a general rule.

You can always ask the config what the readiness is.

```typescript
fhConfig.readiness();
```

### Choosing a connection mode

Call one of these fluent methods on your `EdgeFeatureHubConfig` **before** calling `.init()` or `.build()`:

```typescript
const fhConfig = new EdgeFeatureHubConfig(url, apiKey);

// Active REST — polls at a fixed interval regardless of user activity (default for browser SDK)
fhConfig.restActive(5000); // every 5 seconds

// Passive REST — only polls after the cache expires AND a feature is evaluated
fhConfig.restPassive(15000); // cache expires after 15 seconds

// SSE — real-time streaming updates (default for Node SDK)
fhConfig.streaming();
```

FeatureHub also has the ability for the server to override the polling interval via cache-control headers, either globally or per environment.

## General Documentation

#### Supported feature state requests

On a context, you can ask for the following information. In the browser, the context is available with `FeatureHub.context`,
to make it available in a server app, it is shown in the Quick Start.

- Get a raw feature value through the following methods:
  - `feature('FEATURE_KEY').value` returns whatever the value of this type is as an `any` type. This function is generic so you
    can use `const colour = feature<string>('FEATURE_COLOUR').value` for instance and it will support Typescript generic typing. This method is also available directly on `FeatureHub`.
  - `getFlag('FEATURE_KEY') | getBoolean('FEATURE_KEY')` returns a _boolean_ type feature value - _true_ or _false_. Returns _undefined_ if the feature does not exist or not of _boolean_ type. Alternatively use `feature('FEATURE_KEY').flag`
  - `getNumber('FEATURE_KEY')` returns a _number_ type feature value or _undefined_ if the feature does not exist, or its value not of number type, or feature has no default value. Alternatively use `feature('FEATURE_KEY').num`.
  - `getString('FEATURE_KEY')` returns a _string_ type feature value or _undefined_ if the feature does not exist, or its value not of string type or feature has no default value. Alternatively use `feature('FEATURE_KEY').str`.
  - `getRawJson('FEATURE_KEY')` returns a raw json feature value represented as _string_ or _undefined_ if the feature does not exist, or its value not of JSON type or feature has no default value. Alternatively use `feature('FEATURE_KEY').rawJson`.
- Use convenience functions:
  - `isEnabled('FEATURE_KEY')` - returns _true_
    only if the feature is a boolean and is _true_, otherwise _false_. Alternatively use `feature('FEATURE_KEY').enabled`
  - `isSet('FEATURE_KEY')` - in case a feature value is not set (_null_) (this can only happen for strings, numbers and json types), this check returns _false_.
    If a feature doesn't exist - returns _false_. Otherwise, returns _true_.
  - `getKey()`: returns feature key if feature exists
  - `feature('FEATURE_KEY').exists` - return _true_ if feature exists, otherwise return _false_
  - `feature('FEATURE_KEY').locked` - returns _true_ if feature is locked, otherwise _false_
  - `feature('FEATURE_KEY').version` - returns feature update version number (every change on the feature causes its version to update).
  - `feature('FEATURE_KEY').type` - returns type of feature (boolean, string, number or json)
  - `feature('FEATURE_KEY').addListener` - see _Feature updates listener_ below.

- Get a list of all feature keys from the feature repository

  ```
  const fhClient = await fhConfig.newContext().build();
  console.log("List all feature keys: ", client.repository().simpleFeatures().keys());
  ```

- The primitives to build almost any experience you like is available in the SDK, please feel free to have a look around!

## Rollout Strategies and Client Context

FeatureHub supports client and server side evaluation of complex rollout strategies
that are applied to individual feature values in a specific environment. This includes support of preset rules, e.g. per **_user key_**, **_country_**, **_device type_**, **_platform type_** as well as **_percentage splits_** rules and custom rules that you can create according to your application needs.

Client Contexts are _mutable_ objects - which means you can keep changing them as you need to.

- For server side evaluation, you need to indicate when you have finished a set of changes and call `.build()`. This grabs all of the
  attributes in a context evaluation and sends them off to the server for evaluation to get the new state of the features. If you
  want an accurate subsequent representation of the features, you should `await` this request.
- For client side evaluation, simply changing and using them in evaluations is all that is required. You can however use `.build()`,
  it is simply a no-op. You also do not have to use `await` if you do not `.build()` if you are using a client side key because
  the features are evaluated on the client side.

Getting a new context is covered above, but as a refresher, once you have a `FeatureHubConfig` you can just call:

```typescript
const fhContext = fhConfig.newContext();
```

We will assume in the following examples you have a variable called `fhContext` that represents your context.

For more details on rollout strategies, targeting rules and feature experiments see the [core documentation](https://docs.featurehub.io/featurehub/latest/index.html#_rollout_strategies_and_targeting_rules).

```typescript
await fhContext
  .userKey("user.email@host.com")
  .country(StrategyAttributeCountryName.NewZealand)
  .build();

if (fhClient.isEnabled("FEATURE_KEY")) {
  //do something
}
```

#### Coding for rollout strategies

There are several preset strategies rules we track specifically: `user key`, `country`, `device` and `platform`. However, if those do not satisfy your requirements you also have an ability to attach a custom rule. Custom rules can be created as following types: `string`, `number`, `boolean`, `date`, `date-time`, `semantic-version`, `ip-address`

FeatureHub SDK will match your users according to those rules, so you need to provide attributes to match on in the SDK:

**Sending preset attributes:**

Provide the following attribute to support `userKey` rule:

```typescript
await fhContext.userKey("ideally-unique-id").build();
```

to support `country` rule:

```typescript
await fhContext.country(StrategyAttributeCountryName.NewZealand).build();
```

to support `device` rule:

```typescript
await fhContext.device(StrategyAttributeDeviceName.Browser).build();
```

to support `platform` rule:

```typescript
await fhContext.platform(StrategyAttributePlatformName.Android).build();
```

to support `semantic-version` rule:

```typescript
await fhContext.version("1.2.0").build();
```

or if you are using multiple rules, you can combine attributes as follows:

```typescript
await fhContext
  .userKey("ideally-unique-id")
  .country(StrategyAttributeCountryName.NewZealand)
  .device(StrategyAttributeDeviceName.Browser)
  .platform(StrategyAttributePlatformName.Android)
  .version("1.2.0")
  .build();
```

Note, because the context is mutable, you are building on what you have previously stored. You can call `.clear()` if you
wish to remove what was there before.

**Sending custom attributes:**

To add a custom key/value pair, use `attributeValue(key, value)`

```typescript
await fhContext.attributeValue("first-language", "italian").build();
```

Or with array of values (only applicable to custom rules):

```typescript
await fhContext.attributeValue("languages", ["italian", "english", "german"]).build();
```

If you define a strategy using a custom rule, providing an array will make the SDK compare each value in turn against the rule
and if _any_ matches, the rule will be considered fulfilled.

You can also use `fhClient.clear()` to empty your context.

In all cases, you need to call `build()` to re-trigger passing of the new attributes to the server for recalculation.

**Coding for percentage splits:**
For percentage rollout you are only required to provide the `userKey` or `sessionKey`.

```typescript
await fhContext.userKey("ideally-unique-id").build();
```

or

```typescript
await fhContext.sessionKey("session-id").build();
```

For more details on percentage splits and feature experiments see [Percentage Split Rule](https://docs.featurehub.io/featurehub/latest/index.html#_percentage_split_rule).

#### Feature updates listener

If the SDK detects a feature update, you also have an option to attach listeners
to these updates. The feature value may not change, but you will be able to evaluate the feature
again and determine if it has changed for your _Context_:

```typescript
FeatureHub.feature("FEATURE_KEY").addListener((fs) => {
  console.log(fs.key, "is", fhContext.isEnabled(fs.key));
});
```

What you are passed is the _raw_ feature without any enhancements (including context), so ideally
you would not use this directly, use it from the _Context_.

Note, how fast you get these updates depends on the client you use. If you are using the EventSource
client, it will be close to immediately after they have been updated. If you are using the Polling
client, it will be when the next update happens.

You can attach as many callbacks for each feature as you like. They return a handler, and you can call `.removeListener`
if you wish to stop receiving the events.

### Logging

This client exposes a class called `FHLog` which has two methods, i.e.:

```typescript
export type FHLogMethod = (...args: any[]) => void;
export class FHLog {
  public log: FHLogMethod = (...args: any[]) => {
    console.log(args);
  };
  public error: FHLogMethod = (...args: any[]) => {
    console.error(args);
  };
}
```

You can replace these methods with whatever logger you use to ensure you get the right format logs (e.g. Winston, Bunyan, Log4js).

There is a `.quiet()` method available on FHLog which will silence logs.

### NodeJS server usage

For the full example see [here](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-backend-typescript)

### React usage

For the full example see [here](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript)

##Detailed documentation

### The FeatureHub repository Overview

The FeatureHub repository is a single class that holds and tracks features in your system. It gets features delivered
to it to process, tracks changes, and allows you to find and act on features in a useful way.
It also sends events out in certain circumstances.

### Meta-Events from the repository

There are two "meta events" from the FeatureHub repository, readiness and "new feature available".

#### Readiness

This is covered in some detail above, we won't repeat it here.

#### New Feature State Available

The repository tracks features and their states by version number. When a new version of a feature state arrives,
say a flag changes from off to on, then the repository will check this version is really newer, and if so, it will
(in the default, immediate mode) apply that change to the current feature state it is holding. From this it will
trigger any events on that particular feature, and it can also trigger a generic event -
`postLoadNewFeatureStateAvailable`. This event gets triggered once no matter if a bundle of changes comes in, or a
single change comes in.

You would typically use this to know if events have occurred that mean you need to go back and get event states or
rerender a page or similar.

This event gets a little more complicated when using the second (non default) mode - _catch and release_ - discussed
in more detail with examples below. In this mode, the repository will receive the updates, and compare them, but it
will _not_ apply them to the features in the repository. As such, in this mode, a change on the server that
turns up in the repository (via GET or EventSource) will _not_ be applied to the local feature state, it will be held.
And the effect of this is that this event will _not_ fire. When you tell the repository to process these "held"
changes, then the event will fire.

Attaching a listener for this hook is done like this:

```typescript
fhConfig.repository().addPostLoadNewFeatureStateAvailableListener((_) => {
  // e.g. tell user to page is going to update and re-render page
});
```

## Reacting to feature changes

Unlike the server focused APIs, Typescript/Javascript has two modes of operation.

### Immediate reaction (recommended for servers)

In this mode, as changes occur to features coming from the server, the states of the features will immediately change.
Events are fired. This kind of operation is normally best for servers, as they want to react to what has been asked for.

You do not have to write any code to get this mode as it is the default behaviour.

### Catch and Release (recommended for Web and Mobile)

This is a deliberate holding onto the updates to features until such a time as they are "released". This is separate
from them coming down from the source and being put in the repository. In _catch and release_ mode, the repository will
hold onto the changes (only the latest ones) and apply them when you chose to "release them". This means there will be
no delay while making a GET request for the latest features for example when you wish to "check" for new updates to
features when shifting pages or similar.

This strategy is recommended for Web and Mobile applications as controlled visibility for the user is important.

```javascript
// don't allow feature updates to come through
FeatureHub.config.catchAndReleaseMode = true;
```

If you choose to not have listeners, when you call:

```javascript
fhConfig.release();
```

then you should follow it with code to update your UI with the appropriate changes in features. You
won't know which ones changed, but this can be a more efficient state update than using the listeners above.

## Failure

If for some reason the connection to the FeatureHub server fails - either initially or for some reason during
the process, you will get a readiness state callback to indicate that it has now failed.

```javascript
export enum Readyness {
  NotReady = 'NotReady',
  Ready = 'Ready',
  Failed = 'Failed'
}
```

## Usage Tracking

The SDK has a pluggable usage tracking system that fires whenever a feature is evaluated through a context. This
serves two purposes: it powers the Passive REST polling mode (a feature evaluation can trigger a poll when the
cache has expired), and it lets you send evaluation data to external analytics or observability tools.

UsagePlugins will operate _asynchronously_ but default, so when a UsageEvent is sent to them, it will be inside a "fire and forget"
promise. If you want to ensure it affects something within the context of what the user is doing then it should be synchronous
and you will need to override the `canSendAsync` to `false`. The OpenTelemetry plugins are _not_ async because they need to modify the
baggage of the current context the user is in, the Twilio Segment however is async as it is just sending tracking information.

### Writing a plugin

Implement `UsagePlugin` (or extend `DefaultUsagePlugin`) and implement `send(event: UsageEvent)`:

```typescript
import {
  DefaultUsagePlugin,
  type UsageEvent,
  isUsageEventWithFeature,
  isUsageFeaturesCollection,
} from "featurehub-javascript-client-sdk";

class MyPlugin extends DefaultUsagePlugin {
  // canSendAsync defaults to true — send() is called asynchronously.
  // Set to false if your send() must run synchronously (e.g. inside a span).
  // canSendAsync = false;

  send(event: UsageEvent) {
    const record = event.collectUsageRecord(); // plain object of key/value pairs

    if (isUsageEventWithFeature(event)) {
      // single feature evaluation — event.feature, event.attributes available
    } else if (isUsageFeaturesCollection(event)) {
      // batch of feature values — event.featureValues available
    }

    // send to your analytics system...
  }
}
```

Register it with your config before any features are evaluated:

```typescript
fhConfig.addUsagePlugin(new MyPlugin());
```

### Provided plugins

Two reference plugins are available as separate packages:

#### [`featurehub-usage-segment`](https://www.npmjs.com/package/featurehub-usage-segment) — Twilio Segment

Forwards each feature evaluation to Segment as a `track` call. A companion
`FeatureHubSegmentEnrichmentPlugin` enriches all outgoing Segment events with the current
FeatureHub context. See the [package README](https://www.npmjs.com/package/featurehub-usage-segment)
for full setup instructions.

```typescript
import { SegmentUsagePlugin } from "featurehub-usage-segment";
fhConfig.addUsagePlugin(new SegmentUsagePlugin(() => analytics));
```

#### [`featurehub-usage-opentelemetry`](https://www.npmjs.com/package/featurehub-usage-opentelemetry) — OpenTelemetry

Attaches feature evaluations as attributes or events on the active OpenTelemetry span
(`OpenTelemetryTrackerUsagePlugin`). Also provides **Full-trace Feature Value consistency
support** via `OpenTelemetryBaggagePlugin` and `OpenTelemetryFeatureInterceptor` — a pair that
freezes evaluated feature values into the W3C `baggage` header so every service in a distributed
trace uses the same flag values, even if they change partway through. Node.js only. See the
[package README](https://www.npmjs.com/package/featurehub-usage-opentelemetry) for full setup
instructions.

```typescript
import { OpenTelemetryTrackerUsagePlugin } from "featurehub-usage-opentelemetry";
fhConfig.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin());
```

## Feature Value Interceptors

Feature value interceptors let you override the value of any feature before it is returned to the caller. This is useful for local development overrides, test harnesses, or loading values from a custom source (e.g. a query parameter or a local config file).

### The interface

Implement `FeatureValueInterceptor` from the SDK:

```typescript
import {
  type FeatureValueInterceptor,
  type FeatureHubRepository,
  type FeatureState,
} from "featurehub-javascript-client-sdk";

class MyInterceptor implements FeatureValueInterceptor {
  // Called on every feature value read.
  // Return [true, value] to override, or [false, undefined] to let the normal value through.
  // value can be string | boolean | number | undefined.
  // Returning [true, undefined] overrides the feature to have no value (null/unset).
  matched(
    key: string,
    repo: FeatureHubRepository,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    if (key === "MY_FLAG") {
      return [true, true]; // force the flag on
    }
    return [false, undefined]; // no override
  }
}
```

### Registering an interceptor

```typescript
fhConfig.addValueInterceptor(new MyInterceptor());
```

Or directly on the repository:

```typescript
fhConfig.repository().addValueInterceptor(new MyInterceptor());
```

Multiple interceptors can be registered; they are evaluated in registration order and the first match wins.

### Provided interceptor and store: [`featurehub-yaml-interceptor`](https://www.npmjs.com/package/featurehub-yaml-interceptor)

The [`featurehub-yaml-interceptor`](https://www.npmjs.com/package/featurehub-yaml-interceptor)
package (Node.js only) provides two classes for working with feature flags from a local YAML file
during development and testing, without needing a live FeatureHub connection.

**`LocalYamlValueInterceptor`** — intercepts individual feature lookups and substitutes values
from the YAML file, leaving all other features unaffected. Supports optional hot-reload via
`{ watchForChanges: true }` which polls the file every 500 ms.

```typescript
import { LocalYamlValueInterceptor } from "featurehub-yaml-interceptor";
// File resolved from: explicit arg → FEATUREHUB_LOCAL_YAML env var → featurehub-features.yaml
fhConfig.addValueInterceptor(new LocalYamlValueInterceptor());
```

**`LocalYamlFeatureStore`** — reads the YAML file once at construction and pushes the full
feature set into the repository, making the SDK ready immediately with no network connection.
Types are inferred automatically from the YAML values.

```typescript
import { LocalYamlFeatureStore } from "featurehub-yaml-interceptor";
new LocalYamlFeatureStore(fhConfig);
```

The two classes can be used together: `LocalYamlFeatureStore` for instant startup and
`LocalYamlValueInterceptor` with `watchForChanges: true` for live hot-reload as you edit the
file. See the [package README](https://www.npmjs.com/package/featurehub-yaml-interceptor) for
the full YAML format, type-conversion rules, and combined usage examples.

## Backing Stores

Backing stores sit behind the FeatureHub repository and automatically persist feature state to a
durable location. On startup they replay the stored state into the repository immediately — before
the first edge connection is established — so your application has a usable set of feature values
from the moment it starts.

### [`featurehub-store-localstorage`](https://www.npmjs.com/package/featurehub-store-localstorage) — Browser storage

Persists the full feature state to `sessionStorage` (default) or `localStorage` in the browser.
Useful for single-page applications where you want features available before the FeatureHub
connection resolves. Pass `localStorage` as the second argument to persist across page loads.

```typescript
import { LocalSessionStore } from "featurehub-store-localstorage";
const store = new LocalSessionStore(fhConfig);          // sessionStorage
const store = new LocalSessionStore(fhConfig, localStorage); // across page loads
```

Call `store.close()` to deregister the listener on teardown. See the
[package README](https://www.npmjs.com/package/featurehub-store-localstorage) for full details.

### [`featurehub-store-redis`](https://www.npmjs.com/package/featurehub-store-redis) — Redis (Node.js only)

Persists feature state to Redis for multi-instance Node.js deployments. All instances share a
single cached copy, so a cold-starting process serves features immediately without waiting for
FeatureHub. **Client-evaluated keys only** — server-evaluated keys must not be shared across
evaluation contexts and the store will refuse to initialise if one is detected.

Three connection styles are supported: URL string, `RedisClientOptions` object (TLS, auth, etc.),
or Redis Cluster. Single-node writes use `WATCH`/`MULTI`/`EXEC` optimistic locking with
configurable retry and backoff; cluster writes fall back to sequential SETs. A periodic refresh
timer (default 5 min) detects changes made by other instances via a SHA-256 fingerprint key.

```typescript
import { RedisSessionStoreUrl } from "featurehub-store-redis";
const store = new RedisSessionStoreUrl("redis://localhost:6379", fhConfig);
await store.init();
```

Call `store.close()` on shutdown. See the
[package README](https://www.npmjs.com/package/featurehub-store-redis) for all constructor
variants and configuration options.

## FeatureHub Test API

When writing automated integration tests, it is often desirable to update your feature values, particularly flags.
We provide a method to do this
using the `FeatureUpdater` class. Use of the API is based on the rights of your SDK-URL. Generally you should
only give write access to service accounts in test environments.

When specifying the key, the Edge service will get the latest value of the feature and compare your changes against
it, compare them to your permissions and act accordingly.

You need to pass in an instance of a FeatureStateUpdate, which takes three values, all of which are optional but
must make sense:

- `lock` - this is a boolean. If true it will attempt to lock, false - attempts to unlock. No value will not make any change.
- `value` - this is any kind of value and is passed when you wish to _set_ a value. Do not pass it if you wish to unset the value.
  For a flag this means setting it to false (if null), but for the others it will make it null (not passing it).
- `updateValue` - set this to true if you wish to make the value field null. Otherwise, there is no way to distinguish
  between not setting a value, and setting it to null.

Sample code might look like this:

```typescript
const fu = new FeatureUpdater(fhConfig);

// this would work presuming the correct access rights
fu.updateKey(
  "FEATURE_TITLE_TO_UPPERCASE",
  new FeatureStateUpdate({ lock: false, value: true }),
).then((r) => console.log("result is", r));

// this would not as this key doesn't exist
fu.updateKey("meep", new FeatureStateUpdate({ lock: false, value: true })).then((r) =>
  console.log("result is", r),
);
```

You can do this in the browser and in the sample React application in the examples folder, we have exposed this
class to the `Window` object so you can run up the sample and play around with it. For example:

```javascript
const x = new window.FeatureUpdater(fhConfig);

x.updateKey('meep', {lock: true}).then((r) => console.log('result was', r));
result was false
x.updateKey("FEATURE_TITLE_TO_UPPERCASE", {lock: false}).then((r) => console.log('result was', r));;

result was true
```

### Errors

If a 4xx error is returned, then it will stop. Otherwise it will keep polling even if there is no data on the assumption
it simply hasn't been granted access. The API does not leak information on valid vs invalid environments.

## Angular

This library uses semver, which is a commonjs library. You will need to follow the recommended Angular documentation
on how to suppress the warning.

## Older Versions

We have deprecated [FeatureHub Eventsource Javascript SDK](https://www.npmjs.com/package/featurehub-eventsource-sdk) which covers both client (browser) and server (node) applications in favor of splitting it into two separate NPM modules to enable support for additional browser frameworks like Angular and Vue. To transition to one of the new NPM modules, follow installation instructions below and change the imports in your code. The FeatureHub SDK API hasn't changed so you don't have to reimplement your SDK code.

## Advanced Usage

### Overriding Client creation

The method to create the EventSource request is defined globally and is intended to be overridden. The nodejs library
for example uses the clientjs library and just replaces its "factory" method for creating eventsource clients or polling
clients. You can use this method if you wish to replace the method to create eventsource or polling client creation
requests.

Why would you want to do this? The underlying _nodejs_ libraries allow you more leeway than the browser libraries, for
example in NodeJS you can add extra headers to outgoing requests, or do hand-crafted proxy modification and so forth.
Here we include two examples, one for event sourcing and one for polling under nodejs. You can do the same for the browser
client but there is limited value in doing so..

#### Replacing eventsource clients under nodejs

The constructor for an eventsource client is the same as the standard EventSource constructor - by making it your
own you can add anything you like to the dictionary passed to the standard eventsource library. Below is an example
of passing an extra header:

```typescript
const ES = require("eventsource");

FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  if (!dict) {
    dict = { headers: {} };
  }
  if (!dict.headers) {
    dict.headers = {};
  }
  dict.headers["simple-header"] = "hello";
  return new ES(url, dict);
};
```

This turns up such as:

```http request
> GET http://localhost:8085/features/default/6cd5017f-9803-4c45-a5ed-586041750c27/9NeB8UBVfjbgXdIXVVaHmH3VNapJ1k*jXHKXlZ3vwlkBHmWI8Yn
> accept: text/event-stream
> cache-control: no-cache
> connection: close
> host: localhost:8085
> simple-header: hello
```

#### Replacing the polling client under nodejs

The construction of the polling client request for nodejs is a little more complicated, but there is a callback which passes back
the full request of a poll to your code if you wish. To use it, you again need to intercept the creation mechanism and then you
will get the full set of request options.

```typescript
FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) => {
  const nodeClient = new NodejsPollingService(opt, url, freq, callback);
  nodeClient.modifyRequestFunction = (options: RequestOptions) => {
    options.headers["simple-header"] = "hello";
  };
  return nodeClient;
};
```

This kind of http request turns up as:

```http request
> GET http://localhost:8085/features?sdkUrl=default%2F6cd5017f-9803-4c45-a5ed-586041750c27%2F9NeB8UBVfjbgXdIXVVaHmH3VNapJ1k*jXHKXlZ3vwlkBHmWI8Yn
> connection: close
> host: localhost:8085
> if-none-match: "79f8dcb4"
> simple-header: hello
```
