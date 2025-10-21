# Description

Frontend Todo app to demonstrate the usage of FeatureHub Javascript/Typescript SDK with React front-end framework.

Demonstrates the feature of "STRING" type that controls the colour of a "SUBMIT" button. For example, you can set it as "green", "orange" etc..

In addition, it demonstrates integration with Google Analytics. You will require to have valid GA Tracking ID, e.g. 'UA-XXXXXXXXX-X',
and so the code is currently commented out.

## Pre-requisites

1. Node v20 or higher

2. You need to setup a feature of type "Feature flag - string" in the FeatureHub Admin Console.
   Set feature key to `SUBMIT_COLOR_BUTTON`.

3. In the `public/index.html` file specify the following:

- FeatureHub Edge server Url. It will depend on your installation, e.g.:

`"<meta name="featurehub-url" content="http://localhost:8903"/>`

- You are required to have a Service Account created in the FeatureHub Admin Console with the "read" permissions for your desired environment.
  Once this is set, copy the API Key (Server eval key) from the API Keys page for your desired environment and set it as an environment variable:

`meta name="featurehub-apiKey" content="3f7a1a34-642b-4054-a82f-1ca2d14633ed/4SJ1FNtm4irPfdePtqUJQ4ebOFXvPFXcRcx9OWDa"/>`

- Optionally you can change the polling interval and a test user key

```html
<meta name="featurehub-interval" content="15000" />
<meta name="featurehub-userKey" content="fred" />
```

4. If you like to see events fire in your Google Analytics, you will require to have valid GA Tracking ID, e.g. 'UA-XXXXXXXXX-X'.

5. You also need to specify a CID - a customer id this is associate with GA. In this example it is set to a random number.

Read more about CID [here](https://stackoverflow.com/questions/14227331/what-is-the-client-id-when-sending-tracking-data-to-google-analytics-via-the-mea)

GA events:

`name: "todo-add", value: "10"`

`name: "todo-delete", value: "5"`

Once you launch the app, any interaction with "add" or "delete" buttons will generate a GA event accordingly.

More on GA integration can be found here https://docs.featurehub.io/analytics.html

## Installation Instructions

Install dependencies

`pnpm install`

Run the back-end server:

`cd ../todo-backend-typescript`

provide your Edge Url and API Key in `run.sh` file (this is required as backened server example also connects to FeatureHub for demo purposes)

`pnpm install && pnpm run-script start`

After back-end server has started successfully:

`cd ../todo-frontend-react-typescript`

`pnpm run-script compile`

`pnpm run-script start`
