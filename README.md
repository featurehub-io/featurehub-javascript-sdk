**Client SDK**

[![Build featurehub-javascript-client-sdk](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-client-build.yml/badge.svg)](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-client-build.yml)
[![npm version](https://badge.fury.io/js/featurehub-javascript-client-sdk.svg)](https://badge.fury.io/js/featurehub-javascript-client-sdk)

**Node SDK**

[![Build featurehub-javascript-node-sdk](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-node-build.yml/badge.svg)](https://github.com/featurehub-io/featurehub-javascript-sdk/actions/workflows/typescript-node-build.yml)
[![npm version](https://badge.fury.io/js/featurehub-javascript-node-sdk.svg)](https://badge.fury.io/js/featurehub-javascript-node-sdk)

| Documentation | Changelog | Example Quick links |
|---|---|---|
| [FeatureHub platform docs](https://docs.featurehub.io) | [Changelog Client SDK](https://github.com/featurehub-io/featurehub-javascript-sdk/blob/main/featurehub-javascript-client-sdk/CHANGELOG.md) <br>  [Changelog Node SDK](https://github.com/featurehub-io/featurehub-javascript-sdk/blob/main/featurehub-javascript-node-sdk/CHANGELOG.md) | [React example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript) <br> [Node example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-backend-typescript) <br> [Angular example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-angular/angular-featurehub-app) <br>  [Test automation example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-server-tests) <br> [React Catch & Release mode example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript-catch-and-release) <br> [React Feature Overrides example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript-feature-override) |


# Javascript/Typescript SDK for FeatureHub

## Overview
Welcome to the Javascript/Typescript SDK implementation for [FeatureHub.io](https://featurehub.io) - Open source Feature flags management, A/B testing and remote configuration platform.

This documentation covers both [featurehub-javascript-node-sdk](https://www.npmjs.com/featurehub-javascript-node-sdk) and [featurehub-javascript-client-sdk](https://www.npmjs.com/featurehub-javascript-client-sdk) and explains how you can use the FeatureHub SDK in Javascript or Typescript for applications like Node.js
backend servers, Web front-ends (e.g. Vanilla, React, Angular) or Mobile apps (React Native, Ionic, etc.). 

To control the feature flags from the FeatureHub Admin console, either use FeatureHub SaaS cloud version [demo](https://app.featurehub.io) or install the app using our guide [here](https://docs.featurehub.io/featurehub/latest/installation.html)


## SDK installation

Run to install the dependency: 

if you are intending to use this SDK with React, Angular and other browser frameworks:

`npm install featurehub-javascript-client-sdk`
           
if you are using NodeJS use

`npm install featurehub-javascript-node-sdk`

(and further imports you see below should refer to this node library instead of the client library)


## Options to get feature updates  

There are 2 ways to request for feature updates via this SDK:

- **FeatureHub polling client (GET request updates)** 
  
  In this mode, you make a GET request, which you can choose to either do once, when specific things happen in your application,
  (such as navigation change) or on a regular basis (say every 5 minutes) and the changes will be passed into the FeatureHub repository for processing. This mode is recommended for browser type applications (React, Angular, Vue) and Mobile applications. The `featurehub-javascript-client-sdk` defaults to this behaviour as of 1.2.0, and we have updated and streamlined the browser API to reflect this. 

- **SSE (Server Sent Events) realtime updates mechanism**

  In this mode, you will make a connection to the FeatureHub Edge server using the EventSource, and any updates to any features will come through to you in _near realtime_, automatically updating the feature values in the repository. This method is recommended for server (Node) applications. `featurehub-javascript-node-sdk` is configured to use SSE by default. If you decide to use SSE in the browser applications, there is a known issues in the browsers with Kaspersky antivirus potentially blocking SSE events. [GitHub issue](https://github.com/featurehub-io/featurehub/issues/296)

                     
## Browser Quick Start

### Connecting to FeatureHub
There are 3 steps to connecting:

1) Copy FeatureHub API Key from the FeatureHub Admin Console
2) Create FeatureHub config
3) Request feature state

#### 1. API Key from the FeatureHub Admin Console
Find and copy your Server Eval API Key from the FeatureHub Admin Console on the API Keys page - 
you will use this in your code to configure feature updates for your environments. _Server Side evaluation_ is more suitable when you are using an _insecure client_. (e.g. Browser or Mobile). This means your application is reflecting the actions of a single person. 

It should look similar to this: ```5e61fd62-d4ed-40e0-9cc1-cb3d809f6149/YDr1E4uQGA2Li54fQ0HpmSr2LMv9yHhwzxut2DRO```.

There are other variations of applications where you might want to use a key in a different way from above, we cover more on 
this [in the main FeatureHub documentation](https://docs.featurehub.io/featurehub/latest/sdks.html#_client_and_server_api_keys)

#### 2. Create FeatureHub config:

In your page's HTML, add the following (replacing the urls and keys with your own server details):

```html
    <meta name="featurehub-url" content="http://localhost:8085"/>
    <meta name="featurehub-apiKey" content="c320b6aa-3054-4505-92a5-c01682d47ec2/So1qQ4FOX2UM0Bpxs3r6TqjuDo0WjEIAeYO01dwa"/>
    <meta name="featurehub-interval" content="15000"/>
```

The interval indicates polling frequency to get feature updates and set at 15 seconds. It is normal and expected that your API key will be exposed to the end user in this case, as it is intended to be used in insecure environments. 

```typescript
import {
  FeatureHub
} from 'featurehub-javascript-client-sdk';
```

The above code configured a server evaluated connection and immediately requests to connect and get the
features from the server. See below for why you might want to delay this.

#### 3. Request feature state

In a standard browser situation, there is a single active connection to the FeatureHub server. 
You can ask for the feature state in your conditional code (we use a boolean flag here):

```typescript
if (FeatureHub.feature('FEATURE_KEY').enabled) {
  
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
      if (firstTimeReady) { // its ready and its the first time it has been ready, so make appropriate screen changes
        const value = fhConfig.feature('FEATURE_STRING').str;
        console.log('Value is ', value);
      }
  });
```

Alternatively, you can listen for updates in specific features. 

```typescript
FeatureHub.feature('FEATURE_KEY').addListener((feature) => {
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
const fhConfig = new EdgeFeatureHubConfig(process.env.FEATUREHUB_EDGE_URL, process.env.FEATUREHUB_CLIENT_API_KEY).init();
```

In this case, we are creating a global connection and adding it to the startup of the application and telling it to kick off.

We recommend that for a server application, you include the _readyness_ of the FeatureHub connection in your health check, so
don't let the deployment orchestration (be it a FaaS, kubernetes, ECS, etc) let any traffic route to your server unless you
have a healthy connection to FeatureHub (just like you could with a database):


```typescript
server.get('/health/liveness', (req, res, next) => {
  if (fhConfig.readyness === Readyness.Ready) { // other checks also here
    res.status(200);
    res.send('ok');
  } else {
    res.send('not ready');
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
import { FeatureHubConfig } from './feature_hub_config';

export function userMiddleware(fhConfig: FeatureHubConfig) {
  return (req: any, res: any, next: any) => {
    const user = detectUser(req); // function to analyse the Bearer token and determine who the user is
    
    let fhClient = fhConfig.newContext();
    
    if (user) {
    	fhClient = fhClient.userKey(user.email);
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
app.get('/', function (req, res) {
  if (req.featureContext.feature('FEATURE_KEY').enabled) {
    req.send('The feature is enabled');
  } else {
    res.send('The feature is disabled.');
  }
})
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
const fhConfig = new EdgeFeatureHubConfig('<url>', '<key>'); // no .init()
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
fhConfig.newContext().userKey('<some-user-key>').attributeValues('languages', navigator.languages).build();
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
                const color = FeatureHub.context.getString('SUBMIT_COLOR_BUTTON');
                this.setState({todos: this.state.todos.changeColor(color)});
            }
        });
```

If you are writing a server application, it would be typical to include the features being
available in a health check (as in the Quick Start). If your server is not able to get its features, it should not
receive traffic as a general rule.

You can always ask the config what the readiness is.

```typescript
fhConfig.readiness()
```

### Changing the polling interval

If you are directly creating the EdgeFeatureHubConfig or you are using polling in your app for some other reason,
you may wish to change the interval. So you can change it by setting the 
provider for the "Edge Connector". An example that sets it to five seconds is as follows:

```typescript
import { FeatureHubPollingClient } from 'featurehub-javascript-client-sdk';
const FREQUENCY = 5000; // 5 seconds
EdgeFeatureHubConfig.edgeServiceProvider((repo, config) => new FeatureHubPollingClient(repo, config, FREQUENCY));
```

You can specify however many seconds you want. FeatureHub also has the ability for the server to 
override the polling interval, either globally or per environment, but that is not covered here. Note,
NodeJS servers use the SSE real time streaming updater, they can swap to using polling via the same
mechanism as above.

Please note - you should do this before doing an `EdgeFeatureHubConfig.config()`.

### Changing to SSE (Server Sent Events) - real time streaming updates

If you are keen to see real time updates, then swapping to the Streaming connector is achieved by:

```typescript
EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repository, config) => new FeatureHubEventSourceClient(config, repository);
```

This is a default method for feature updates in the featurehub-node-sdk.

## General Documentation

#### Supported feature state requests
         
On a context, you can ask for the following information. In the browser, the context is available with `FeatureHub.context`,
to make it available in a server app, it is shown in the Quick Start.

* Get a raw feature value through the following methods:
  - `feature('FEATURE_KEY').value` returns whatever the value of this type is as an `any` type. This function is generic so you
can use `const colour = feature<string>('FEATURE_COLOUR').value` for instance and it will support Typescript generic typing. This method is also available directly on `FeatureHub`.  
  - `getFlag('FEATURE_KEY') | getBoolean('FEATURE_KEY')` returns a _boolean_ type feature value - _true_ or _false_. Returns  _undefined_ if the feature does not exist or not of _boolean_ type. Alternatively use `feature('FEATURE_KEY').flag`
  - `getNumber('FEATURE_KEY')` returns a _number_ type feature value or _undefined_ if the feature does not exist, or its value not of number type, or feature has no default value. Alternatively use `feature('FEATURE_KEY').num`.
  - `getString('FEATURE_KEY')` returns a _string_ type feature value or _undefined_ if the feature does not exist, or its value not of string type or feature has no default value. Alternatively use `feature('FEATURE_KEY').str`. 
  - `getRawJson('FEATURE_KEY')` returns a raw json feature value represented as _string_ or _undefined_ if the feature does not exist, or its value not of JSON type or feature has no default value. Alternatively use  `feature('FEATURE_KEY').rawJson`.
* Use convenience functions:
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

* Get a list of all feature keys from the feature repository
  ```
  const fhClient = await fhConfig.newContext().build();
  console.log("List all feature keys: ", client.repository().simpleFeatures().keys());
  ```

* The primitives to build almost any experience you like is available in the SDK, please feel free to have a look around!

## Rollout Strategies and Client Context

FeatureHub supports client and server side evaluation of complex rollout strategies
that are applied to individual feature values in a specific environment. This includes support of preset rules, e.g. per **_user key_**, **_country_**, **_device type_**, **_platform type_** as well as **_percentage splits_** rules and custom rules that you can create according to your application needs.

Client Contexts are _mutable_ objects - which means you can keep changing them as you need to. 

* For server side evaluation, you need to indicate when you have finished a set of changes and call `.build()`. This grabs all of the
attributes in a context evaluation and sends them off to the server for evaluation to get the new state of the features. If you 
want an accurate subsequent representation of the features, you should `await` this request. 
* For client side evaluation, simply changing and using them in evaluations is all that is required. You can however use `.build()`, 
it is simply a no-op. You also do not have to use `await` if you do not `.build()` if you are using a client side key because
 the features are evaluated on the client side.

Getting a new context is covered above, but as a refresher, once you have a `FeatureHubConfig` you can just call:

```typescript
const fhContext = fhConfig.newContext();
```

We will assume in the following examples you have a variable called `fhContext` that represents your context.

For more details on rollout strategies, targeting rules and feature experiments see the [core documentation](https://docs.featurehub.io/featurehub/latest/index.html#_rollout_strategies_and_targeting_rules).

```typescript
    await fhContext.userKey('user.email@host.com').country(StrategyAttributeCountryName.NewZealand).build();

    if (fhClient.isEnabled('FEATURE_KEY')) {
        //do something
    };
```

#### Coding for rollout strategies

There are several preset strategies rules we track specifically: `user key`, `country`, `device` and `platform`. However, if those do not satisfy your requirements you also have an ability to attach a custom rule. Custom rules can be created as following types: `string`, `number`, `boolean`, `date`, `date-time`, `semantic-version`, `ip-address`

FeatureHub SDK will match your users according to those rules, so you need to provide attributes to match on in the SDK:

**Sending preset attributes:**

Provide the following attribute to support `userKey` rule:

```typescript
    await fhContext.userKey('ideally-unique-id').build(); 
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
    await fhContext.version('1.2.0').build(); 
```

or if you are using multiple rules, you can combine attributes as follows:

```typescript
    await fhContext.userKey('ideally-unique-id')
      .country(StrategyAttributeCountryName.NewZealand)
      .device(StrategyAttributeDeviceName.Browser)
      .platform(StrategyAttributePlatformName.Android)
      .version('1.2.0')
      .build(); 
```

Note, because the context is mutable, you are building on what you have previously stored. You can call `.clear()` if you
wish to remove what was there before.

**Sending custom attributes:**

To add a custom key/value pair, use `attributeValue(key, value)`

```typescript
    await fhContext.attributeValue('first-language', 'italian').build();
```

Or with array of values (only applicable to custom rules):

```typescript
   await fhContext.attributeValue('languages', ['italian', 'english', 'german']).build();
```

If you define a strategy using a custom rule, providing an array will make the SDK compare each value in turn against the rule 
and if *any* matches, the rule will be considered fulfilled.

You can also use `fhClient.clear()` to empty your context.

In all cases, you need to call `build()` to re-trigger passing of the new attributes to the server for recalculation.


**Coding for percentage splits:**
For percentage rollout you are only required to provide the `userKey` or `sessionKey`.

```typescript
    await fhContext.userKey('ideally-unique-id').build();
```
or

```typescript
    await fhContext.sessionKey('session-id').build();
```

For more details on percentage splits and feature experiments see [Percentage Split Rule](https://docs.featurehub.io/featurehub/latest/index.html#_percentage_split_rule).


#### Feature updates listener

If the SDK detects a feature update, you also have an option to attach listeners
to these updates. The feature value may not change, but you will be able to evaluate the feature
again and determine if it has changed for your _Context_:

```typescript
FeatureHub.feature('FEATURE_KEY').addListener((fs) => {
  console.log(fs.key, 'is', fhContext.isEnabled(fs.key));
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
  public log: FHLogMethod = (...args: any[]) => { console.log(args); };
  public error: FHLogMethod = (...args: any[]) => { console.error(args); };
}
```

You can replace these methods with whatever logger you use to ensure you get the right format logs (e.g. Winston, Bunyan, Log4js). 

There is a `.quiet()` method available on FHLog which will silence logs.

### Connecting to Google Analytics

To see feature analytics (events) fire in your Google Analytics, you will require to have valid GA Tracking ID, e.g. 'UA-XXXXXXXXX-X'.
You also need to specify a CID - a customer id this is associate with GA.
Read more about CID [here](https://stackoverflow.com/questions/14227331/what-is-the-client-id-when-sending-tracking-data-to-google-analytics-via-the-mea)

```typescript
// add an analytics adapter with a random or known CID
  fhConfig.addAnalyticCollector(new GoogleAnalyticsCollector('UA-1234', '1234-5678-abcd-1234'));   
```

To log an event in Google Analytics: 
 ```typescript
fhClient.logAnalyticsEvent('todo-add', new Map([['gaValue', '10']]));  //indicate value of the event through gaValue   
```

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
will *not* apply them to the features in the repository. As such, in this mode, a change on the server that 
turns up in the repository (via GET or EventSource) will *not* be applied to the local feature state, it will be held.
And the effect of this is that this event will _not_ fire. When you tell the repository to process these "held" 
changes, then the event will fire. 

Attaching a listener for this hook is done like this:

```typescript
fhConfig.repository()
  .addPostLoadNewFeatureStateAvailableListener((_) => {
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

## Analytics

Allows you to connect your application and see your features performing in Google Analytics.

When you log an event on the repository,
it will capture the value of all of the feature flags and feature values (in case they change),
and log that event against your Google Analytics, once for each feature. This allows you to
slice and dice your events by state each of the features were in. We send them as a batch, so it
is only one request.

Note that if you log the analytics event _on the client context_ (`ctx.logAnalyticsEvent`) it captures that user's features. If you log
them on the repository itself (`fhConfig.repository().logAnalyticsEvent...`) then it logs the features as they are
handed back from the server. If you are using a Server Evaluated Key, these will be the same, but you should try
and always use the Client Context to log analytics events.

There are two different implementations, one for when you are in the browser and one for when you
are in the server, like nodejs. You don't need to worry about this, the code detects which one it is in and 
creates the correct instance. 

There is a plan to support other Analytics tools in the future. The only one we
currently support is Google Analytics, so you need:

- a Google analytics key - usually in the form `UA-123456`. You must provide this up front.
- a CID - a customer id this is associate with this. You can provide this up front or you can
provide it with each call, or you can set it later. 

1) You can set it in the constructor:

```typescript
const collector = new GoogleAnalyticsCollector('UA-123456', 'some-CID');
```

2) You can tell the collector later.

```typescript
const collector = new GoogleAnalyticsCollector('UA-123456');
collector.cid = 'some-value'; // you can set it here
```

3) When you log an event, you can pass it in the map:

```typescript
const data = new Map<string, string>();
data.set('cid', 'some-cid');

ctx.logAnalyticsEvent('event-name', data);
```

4) For a NODE server, you can set as an environment variable named `GA_CID`.

```typescript
fhConfig.addAnalyticCollector(collector);
```

As you can see from above (in option 3), to log an event, you simply tell the repository to
log an analytics event. It will take care of bundling everything up, passing it off to the
Google Analytics collector which will post it off.

Read more on how to interpret events in Google Analytics [here](https://docs.featurehub.io/featurehub/latest/analytics.html)

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
fu.updateKey('FEATURE_TITLE_TO_UPPERCASE', new FeatureStateUpdate({lock: false, value: true})).then((r) => console.log('result is', r));

// this would not as this key doesn't exist
fu.updateKey('meep', new FeatureStateUpdate({lock: false, value: true})).then((r) => console.log('result is', r));
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
const ES = require('eventsource');

FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  if (!dict) {
    dict = {headers: {}};
  }
  if (!dict.headers) {
    dict.headers = {};
  }
  dict.headers['simple-header'] = 'hello';
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
    options.headers['simple-header'] = 'hello'
  }
  return nodeClient;
}
```

This kind of http request turns up as:

```http request
> GET http://localhost:8085/features?sdkUrl=default%2F6cd5017f-9803-4c45-a5ed-586041750c27%2F9NeB8UBVfjbgXdIXVVaHmH3VNapJ1k*jXHKXlZ3vwlkBHmWI8Yn
> connection: close
> host: localhost:8085
> if-none-match: "79f8dcb4"
> simple-header: hello
```
