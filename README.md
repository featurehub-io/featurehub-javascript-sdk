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

To control the feature flags from the FeatureHub Admin console, either use our [demo](https://demo.featurehub.io) version for evaluation or install the app using our guide [here](https://docs.featurehub.io/featurehub/latest/installation.html)

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
  (such as navigation change) or on a regular basis (say every 5 minutes) and the changes will be passed into the FeatureHub repository for processing. This mode is recommended for browser type applications (React, Angular, Vue) and Mobile applications. The SDK defaults to this behaviour as of 1.2.0. 

- **SSE (Server Sent Events) realtime updates mechanism**

  In this mode, you will make a connection to the FeatureHub Edge server using the EventSource, and any updates to any features will come through to you in _near realtime_, automatically updating the feature values in the repository. This method is recommended for server (Node) applications. If you decide to use it in the browser applications, there is a known issues in the browsers with Kaspersky antivirus potentially blocking SSE events. [GitHub issue](https://github.com/featurehub-io/featurehub/issues/296)

## Quick start

### Connecting to FeatureHub
There are 3 steps to connecting:
1) Copy FeatureHub API Key from the FeatureHub Admin Console
2) Create FeatureHub config
3) Request feature state

#### 1. API Key from the FeatureHub Admin Console
Find and copy your API Key from the FeatureHub Admin Console on the API Keys page - 
you will use this in your code to configure feature updates for your environments. 

It should look similar to this: ```5e61fd62-d4ed-40e0-9cc1-cb3d809f6149/YDr1E4uQGA2Li54fQ0HpmSr2LMv9yHhwzxut2DRO```.

If you are using FeatureHub SaaS, you can get your URL from the same page. 

There are two options 

* _Client Side evaluation_ is intended for use in secure environments (such as microservices, e.g Node JS) and is intended for rapid client side evaluation, per request for example.

* _Server Side evaluation_ is more suitable when you are using an _insecure client_. (e.g. Browser or Mobile). This also means you evaluate one user per client.

More on this [here](https://docs.featurehub.io/featurehub/latest/sdks.html#_client_and_server_api_keys)

#### 2. Create FeatureHub config:

We will use a Browser example here, so prefer a Server Evaluated Key (it won't have an `*` in it).

```typescript
import {
  EdgeFeatureHubConfig,
  ClientContext,
  Readyness,
} from 'featurehub-javascript-client-sdk';

const edgeUrl = 'http://localhost:8085/';
const apiKey = '3f7a1a34-642b-4054-a82f-1ca2d14633ed/aH0l9TDXzauYq6rKQzVUPwbzmzGRqe';

const fhConfig = EdgeFeatureHubConfig.config(edgeUrl, apiKey).init();
```

As we are focused on the most common use case, we will use the defaults here - which will create
a Polling client with a 30 second delay between polls (see below for alternatives). The above
code configured a server evaluated connection and immediately requests to connect and get the
features from the server. See below for why you might delay this.

#### 3. Add listener to feature and react

In a normal browser situation, there is a single active connection to the FeatureHub server,
and features can be listened to before that connection is even established. 

You can specifically ask for the feature state in your code (we use a flag here):

```typescript
if (fhConfig.feature('FEATURE_KEY').flag) {
  
}
```
 
The downside of this is that you have to ensure that the FeatureHub SDK has state. In our _Step 2_ above, we added a `.init()` which
was designed to tell the repository to asynchronously go and fill itself. It will cache the data in the Browser's `localstorage` if it can
to ensure speedy startup next time. 

A feature does not have to exist already for your code to function,  the flag evaluation above will simply return falsy
if there is no value for it yet. But you can _react_ to changes in feature state. If you wish parts of your page to render
when the feature repository gains state, you can listen for the event:

```typescript
  fhConfig.addReadynessListener((readyness, firstTimeReady) => {
      if (firstTimeReady) { // its ready and its the first time it has been ready, so make appropriate screen changes
        const value = fhConfig.feature('FEATURE_STRING').str;
        console.log('Value is ', value);
      }
  });
```

Alternatively, you can listen for events for changes in specific 
As such, typically you will write your code to react to changes in the features, such as:

```typescript
fhConfig.feature('FEATURE_KEY').addListener((feature) => {
  if (feature.flag) {
    // perform some UI update
  }
});
```



This is a simple scenario where you request for default context without passing information for each user. In production, you would normally create new context per each user and if you are applying flag variations, you would pass information about user context. If you are using percentage rollout, for example, you would set a `sessionId`, or some other identifier that you can set through `userKey`). 

Frameworks like express and restify work by implementing a middleware concept that allows wraparound logic for each request. In a Node JS server, we would typically add to the part that finds the user something that is able to create a new context, configure it for the detected user and stash it in the request ready for the actual
method that processes this request to use.

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

A simple GET method on / for example could now determine based on the user if they should send one message or
another:

```typescript
app.get('/', function (req, res) {
	if (req.featureContext.isEnabled('FEATURE_KEY')) {
		req.send('The feature is enabled');
  } else {
    res.send('The feature is disabled.');
  }
})
```
     


**Server side evaluation**

In the server side evaluation (e.g. browser app) the context is created once as you evaluate one user per client. 

```typescript
let initialized = false;
let fhClient: ClientContext;
const fhConfig = new EdgeFeatureHubConfig(edgeUrl, apiKey);

async initializeFeatureHub() {
  fhClient = await fhConfig.newContext().build();
  fhConfig.addReadinessListener((readiness) => {
    if (!initialized) {
      if (readiness === Readyness.Ready) {
        initialized = true;
        const value = fhClient.getString('FEATURE_KEY');
        console.log('Value is ', value);
      }
    }
  });

  // if using flag variations and setting rollout strategies,.e.g with a country rule
  fhClient
      .country(StrategyAttributeCountryName.Australia)
      .build();

  // react to incoming feature changes in real-time. With NodeJS apps it is recommended to 
  // use it as a global variable to avoid a memory leak
  fhClient.feature('FEATURE_KEY').addListener(fs => {
    console.log('Value is ', fs.getString());
  });
}
 
this.initializeFeatureHub();
```

  Note, in a Single Page Application (SPA) situation, you will typically load and configure your FeatureHub configuration, but not discover information about a user until later. This would mean that you could progressively add extra information to the context over time, once the user logs in, etc. There are all sorts of different ways that Web applications find and
  provide information. In our [React example](https://github.com/featurehub-io/featurehub-javascript-sdk/tree/main/examples/todo-frontend-react-typescript) we show how once you have your connection you are able to start querying the repository immediately.
        
## Beyond the Quick Start: 

In this section we cover a bundle of different variations that crop up, for clients and servers.
                                         
### Why delay the init()?

FeatureHub is able to provide targeting - to support progressive rollouts, targetted rollouts and even
A/B testing. By creating your config and immediately initializing, you miss the first opportunity to
customise the connection. You can customise this connection at any time however, particularly in
browser based information you may not know what information you wish to customise with until after you
have logged in.

In our step 2 from the Quick Start you can see:

```typescript
const fhConfig = EdgeFeatureHubConfig.config(edgeUrl, apiKey).init();
```

If you wish for example to specify the languages and user name of the person up front you can do this:

```typescript
const fhConfig = EdgeFeatureHubConfig.config(edgeUrl, apiKey);
fhConfig.newContext().userKey('<some-user-key>').attributeValues('languages', navigator.languages).build();
```

This tells the SDK to hold onto that those pieces of information and provide targeted evaluation
against them. 

**Important Note** - you can change these at any time, just remember to add `.build()` on the end. You also do not require the `init()` because this process will do it for you.

### What is the deal with readyness?

Readyness indicates to you when the SDK has received state, or failed to receive state. There is an event on the SDK called
`addReadynessListener` - and that will tell you two things: what is the state of the readyness and is it the first time that
it has called you back with a 

### Changing the polling interval

If the polling interval is too slow or too fast for you, then you can change it by setting the 
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

### Changing to SSE - real time streaming updates

If you are keen to see real time updates, then swapping to the Streaming connector is achieved by:

```typescript
EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repository, config) => new FeatureHubEventSourceClient(config, repository);
```

This is automatically done when you use the node-sdk.

### Knowing when the features are actually ready?
                                               
If you are writing a server application, it would be typical to include the features being
available in a health check. If your server is not able to get its features, it should not
receive traffic as a general rule.

```typescript
fhConfig.readiness()
```


### Doing something when the features are ready

In some cases, you may wish to wait for features to become ready. 



```typescript
let initialized = false;
console.log("Waiting for features...");
fhConfig.addReadinessListener(async (ready) => {
if (!initialized) {
if (ready == Readyness.Ready) {
console.log("Features are available, starting server...");
initialized = true;

      if(fhClient.getFlag('FEATURE_KEY')) { 
          // do something
      }
      else {
          //do something else
      }
    }
}
}, true);

fhConfig.init();
```



#### Supported feature state requests

* Get a raw feature value through the following methods:
  - `feature('FEATURE_KEY').value` returns whatever the value of this type is as an `any` type. This function is generic so you
can use `const colour = feature<string>('FEATURE_COLOUR').value` for instance and it will support Typescript generic typing.  
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
  

## Rollout Strategies and Client Context

FeatureHub supports client and server side evaluation of complex rollout strategies
that are applied to individual feature values in a specific environment. This includes support of preset rules, e.g. per **_user key_**, **_country_**, **_device type_**, **_platform type_** as well as **_percentage splits_** rules and custom rules that you can create according to your application needs.


For more details on rollout strategies, targeting rules and feature experiments see the [core documentation](https://docs.featurehub.io/featurehub/latest/index.html#_rollout_strategies_and_targeting_rules).

```typescript
const fhClient = await fhConfig.newContext().userKey('user.email@host.com').country(StrategyAttributeCountryName.NewZealand)
 	.build();

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
    const fhClient = await fhConfig.newContext().userKey('ideally-unique-id').build(); 
```

to support `country` rule:

```typescript
    const fhClient = await fhConfig.newContext().country(StrategyAttributeCountryName.NewZealand).build(); 
```

to support `device` rule:

```typescript
    const fhClient = await fhConfig.newContext().device(StrategyAttributeDeviceName.Browser).build(); 
```

to support `platform` rule:

```typescript
    const fhClient = await fhConfig.newContext().platform(StrategyAttributePlatformName.Android).build(); 
```

to support `semantic-version` rule:

```typescript
    const fhClient = await fhConfig.newContext().version('1.2.0').build(); 
```

or if you are using multiple rules, you can combine attributes as follows:

```typescript
    const fhClient = await fhConfig.newContext().userKey('ideally-unique-id')
      .country(StrategyAttributeCountryName.NewZealand)
      .device(StrategyAttributeDeviceName.Browser)
      .platform(StrategyAttributePlatformName.Android)
      .version('1.2.0')
      .build(); 
```

The `build()` method will trigger the regeneration of a special header (`x-featurehub`) or parameter (in NodeJS is it is a header, in the Browser it is a parameter as the SSE spec doesn’t allow for extra headers). This in turn
will automatically retrigger a refresh of your events if you have already connected (unless you are using polling
and your polling interval is set to 0).

**Sending custom attributes:**

To add a custom key/value pair, use `attribute_value(key, value)`

```typescript
    const fhClient = await fhConfig.newContext().attribute_value('first-language', 'italian').build();
```

Or with array of values (only applicable to custom rules):

```typescript
   const fhClient = await fhConfig.newContext().attribute_value('languages', ['italian', 'english', 'german']).build();
```

If you define a strategy using a custom rule, providing an array will make the SDK compare each value in turn against the rule 
and if *any* matches, the rule will be considered fulfilled.

You can also use `fhClient.clear()` to empty your context.

In all cases, you need to call `build()` to re-trigger passing of the new attributes to the server for recalculation.


**Coding for percentage splits:**
For percentage rollout you are only required to provide the `userKey` or `sessionKey`.

```typescript
    await fhConfig.newContext().userKey('ideally-unique-id').build();
```
or

```typescript
    await fhConfig.newContext().sessionKey('session-id').build();
```

For more details on percentage splits and feature experiments see [Percentage Split Rule](https://docs.featurehub.io/featurehub/latest/index.html#_percentage_split_rule).



#### Feature updates listener

If the SDK detects a feature update, you also have an option to attach listeners
to these updates. The feature value may not change, but you will be able to evaluate the feature
again and determine if it has changed for your _Context_:

```typescript
const fhClient = await fhConfig.newContext().build();
fhConfig.repository().feature('FEATURE_KEY').addListener((fs) => {
  console.log(fs.getKey(), 'is', fhClient.isEnabled(fs.getKey()));
});
```

What you are passed is the _raw_ feature without any enhancements (including context), so ideally
you would not use this directly, use it from the _Context_.

Note, how fast you get these updates depends on the client you use. If you are using the EventSource
client, it will be close to immediately after they have been updated. If you are using the Polling
client, it will be when the next update happens.

You can attach as many callbacks for each feature as you like.

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

### SSE connectivity 

SSE kills your connection regularly to ensure stale connections are removed. For this reason you will see the connection being dropped and then reconnected again every 30-60 seconds. This is expected and in the below snippet you can see how you can potentially deal with the server readiness check. If you would like to change the reconnection interval, you have an option of changing maxSlots in the Edge server.

Check FeatureHub Repository readiness and request feature state:

```typescript
fhConfig.init();
let failCounter = 0;
let fhInitialized = false;

fhConfig.addReadinessListener(async (readyness: Readyness): void => {
  if (!fhInitialized && readyness === Readyness.Ready) {
    logger.event('started_featurehub_event', Level.Info, 'Connected to FeatureHub');
    startServer();
    fhInitialized = true;
    const fhClient = await fhConfig.newContext().build();
    if (fhClient.getFlag('FEATURE_KEY')) {
      // do something
    }
  } else if (readyness === Readyness.Failed && failCounter > 5) {
    logger.event('featurehub_readyness_failed', Level.Error, 'Failed to connect to FeatureHub');
    process.exit(1);
  } else if (readyness === Readyness.Failed) {
    failCounter++;
  } else {
    failCounter = 0;
  }
}, true);
```

 If it is important to your server instances that the connection to the feature server exists as a critical service, then the snippet above will ensure it will try and connect (say five times) and then kill the server process alerting you to a failure. If connection to the feature service is only important for initial starting of your server, then you can simply listen for the first readiness and start your server and ignore all subsequent notifications:


```typescript
let initialized = false;
console.log("Waiting for features...");
fhConfig.addReadinessListener(async (ready) => {
  if (!initialized) {
    if (ready == Readyness.Ready) {
      console.log("Features are available, starting server...");
      initialized = true;
      const fhClient = await fhConfig.newContext().build();
      if(fhClient.getFlag('FEATURE_KEY')) { 
          // do something
      }
      else {
          //do something else
      }
    }
  }
}, true);

fhConfig.init();

```


### Meta-Events from the repository

There are two "meta events" from the FeatureHub repository, readiness and "new feature available". 

#### Readiness 

Readiness is triggered when your repository first receives a list of features or it fails on a subsequent update. In a
UI application this would indicate that you had all the state necessary to show the application. In a nodejs server,
this would indicate when you could start serving requests.

````typescript
fhConfig.addReadinessListener((readyness) => {
  if (readyness === Readyness.Ready) {
       console.log("Features are available, starting server...");
   
       api.listen(port, function () {
         console.log('server is listening on port', port);
       })
  }
});
````

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
fhConfig.catchAndReleaseMode = true; 
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

## Feature consistency between client and server

There are a number of use cases where it makes sense that the features the client sees should be the same
as the features that the server sees. In any environment however where both the server and client are pulling (or
getting pushed) their features from the FeatureHub servers, both should update at the same time. 

With the _Catch and Release_ functionality however, the client may choose to stash those incoming changes and not 
apply them, but the _server will not know this_. We need a method of allowing the client to tell the server
what features it is using so it knows which ones to apply. This actually becomes more interesting when you consider
server to server communication down the line as well, where you ideally wish to pass the feature state through
http and event-streaming layers if possible. 

The second use case is when doing any kind of testing, being able to indicate on each request in a Mocha / Jest / Cucumber
test that a feature is in a particular state lets you _parallelize_ your testing. If you have to set the entire
environment to a particular state, you can only run tests that expect those features in those states and you can very
quickly get sufficiently complex in your feature set that testing becomes a nightmare.

There is an important caveat to this. You can only send features that exist and _are not locked_. Locked features 
cannot be overridden. The reason for this is that in "catch and release" mode, you may wish to keep overriding features
available even in your production application. However, this could lead to hackers trying to turn on un-ready features
so forcing features to be locked and false is an important security safeguard.

### W3C Baggage Standard

In FeatureHub we are using the [W3C Baggage standard](https://w3c.github.io/baggage/) to pass the feature states. 
This concept is not new, it has been used in tracing stacks
for a long time, and forms a crucial part of the CNCF's OpenTelemetry project. At time of writing the header name and
format is close to agreement, such that several significant open source projects have decided to use it. 
We have decided to use it as well. The benefit will be in a cloud native environment, more tools will recognize and
understand this header and you will end up getting a lot of extra value for having used it (such as distributed
logging, tracing and diagnostics).

It essentially lets you send key/value pairs between servers using any transport mechanism and there is a guarantee
that servers will pass that header on down the wire.

A caveat is that you need to make sure that the header `Baggage` is added to your allowed CORS headers on your
server.

### Using in a browser

In a browser, we expect that you will want to make sure that the server knows what features you are using. This is 
an example using Axios:

```typescript 
import {
  w3cBaggageHeader
} from 'featurehub-repository';

globalAxios.interceptors.request.use(function (config: AxiosRequestConfig) {
  const baggage = w3cBaggageHeader({repo: fhConfig.repository(), header: config.headers.baggage});
  if (baggage) {
    config.headers.baggage = baggage;
  }
  return config;
}, function (error: any) {
  // Do something with request error
  return Promise.reject(error);
});
```     

This just ensures that with every outgoing request, we take any existing `Baggage` header you may have you tell the 
w3cBaggageHeader method what your repository
is and what the existing baggage header is. Note we give you the option to pass the repository, if you are using
the default one, you can leave the repo out. The above example could just be:

```typescript
  const baggage = w3cBaggageHeader({});
```  

### Using in a test API

Another option lets you override the values, not even requiring a repository on your side. This is useful inside
an API oriented test where you want to define a test that specifies a particular feature value or values. To support this,
the other way of calling the `w3cBaggageHeader` method is to pass a name of keys and their values (which may be strings or 
undefined - for non flag values, undefined for a flag value is false). So

```typescript
  const baggage = w3cBaggageHeader({values: new Map([['FEATURE_FLAG', 'true'], ['FEATURE_STRING', undefined]])});
```  

Will generate a baggage header that your server will understand as overriding those values. 

### User testing in a browser

Sometimes it can be useful to allow the user to be able to turn features on and off, something a manual tester
or someone testing some functionality in a UAT environment. Being able to do this for _just them_ is particularly
useful. FeatureHub allows you to do this by the concept of a User Repository, where the normal feature repository
for an environment is wrapped and any overridden values are stored in local storage, so when you move from page 
to page (if using page based or a Single-Page-App), as long as the repository you use is the User Repository, 
it will honour the values you have set and pass them using the Baggage headers.


### Using on the server (nodejs)

Both express and restify use the concept of middleware - where you can give it a function that will be passed the
request, response and a next function that needs to be called. We take advantage of this to extract the baggage header,
determine if it has a featurehub set of overrides in it and create a `FeatureHubRepository` that holds onto these
overrides but keeps the normal repository as a fallback. It _overlays_ the normal repository with the overridden
values (unless they are locked) and puts this overlay repository into the request.

To use it in either express or restify, you need to `use` it.

```typescript
import {featurehubMiddleware} from 'featurehub-repository';

api.use(featurehubMiddleware(fhConfig.repository()));
```

In your own middleware where you create a context, you need to make sure you pass the repository when
creating a new context. So do this:

```typescript
  req.ctx = await fhConfig.newContext(req.featureHub, null).build();
```

this means when you are processing your request it will attempt to use the baggage override first and then
fall back onto the rules in your featurehub repository. Your code still looks the same inside your nodejs code. 

```typescript
if (req.ctx.feature('FEATURE_TITLE_TO_UPPERCASE').getBoolean()) {
}
```
                      
However it is recommended that you wrap your own user authentication middleware and create a user context and
stash that in your request. `newContext` allows you  to pass in the repository so you will be able to put in:

```typescript
req.context = await fhConfig.newContext(req.repo, null).userKey('user.name@email').build();
```

If you log an event against the analytics provider, we will preserve your per-request overrides as well so they will
get logged correctly. e.g.

```typescript
req.context.logAnalyticsEvent('todo-add', new Map([['gaValue', '10']]));
``` 

Will use the overlay values by preference over the ones in the repository.

### Node -> Node

If you are making a call from one node server to another FeatureHub integrated server (in any supported language)
where Baggage is wired in, you can use the per request repository to pass to the `w3BaggageContext` method.

This means you can go:

```typescript
const baggage = w3cBaggageHeader({repo: req.repo, header: req.header('baggage')});
```

And if defined, add the baggage header to your outgoing request.

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