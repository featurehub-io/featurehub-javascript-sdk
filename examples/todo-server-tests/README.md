# Prerequisites

Requires to setup the following features in the FeatureHub Admin Console:

- FEATURE_TITLE_TO_UPPERCASE (boolean)
- FEATURE_NUMBER (number)
- FEATURE_STRING (string)
- FEATURE_JSON (json)

The values can be left as "not set", as they are controlled from the tests. Application name can be anything.

Set environment variables for the tests:

`APP_SERVER_URL` - the backend server under test. In this example using the app in `todo-backend-typescript` folder. Required to be started before running the tests.

`FEATUREHUB_CLIENT_API_KEY` - the FeatureHub API Key (Client eval key) that can be obtained from the admin console for your application test environment. Make sure you enable all the permissions, lock, unlock, read, write

`FEATUREHUB_EDGE_URL` - FeatureHub Edge Url, e.g http://localhost:8903/'

Example:
`APP_SERVER_URL=http://localhost:8099`

`FEATUREHUB_CLIENT_API_KEY=default/4148dcad-b9e2-40d9-9f4f-d1322f899583/Gv5pom5e0JKVlphnsj0NMIwLxAAkB7GAPC91Y92fbb7Pj5SAeAK8JlnGy4PaREA4OsnxxfbdVGIAEW5O`

## To run the tests:

`pnpm install`

`pnpm run generate:specs`

`APP_SERVER_URL='your-server-url' FEATUREHUB_EDGE_URL='fh-edge-url' FEATUREHUB_CLIENT_API_KEY='fh-api-key' pnpm run test`

## Scenario tags

These tests are meant to check a todo server written in any language with any FeatureHub SDK. The server under test is whatever is running at `APP_SERVER_URL`. Every scenario has exactly one of these tags:

- `@todo-api` - changes a feature in FeatureHub, then calls the todo server API and checks that the server picked up the new value. These scenarios test the implementation under test and its SDK.
- `@featurehub-only` - talks only to FeatureHub (the admin API, plus the JavaScript SDK inside this test harness), for example checking feature locking and value validation. These never call the todo server, so they tell you nothing about the implementation under test.

To check a todo server implementation, run only the `@todo-api` scenarios, e.g. from the repository root:

`make test-server-tags TAGS=@todo-api`

or directly:

`pnpm run test -- --tags @todo-api`

FeatureHub must still be running for `@todo-api` scenarios, because their hooks set feature values through the FeatureHub admin API.
