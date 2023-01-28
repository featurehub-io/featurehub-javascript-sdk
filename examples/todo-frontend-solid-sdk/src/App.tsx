import { Component, createSignal, createEffect } from "solid-js";

import logoSolid from "./logo.svg";
import logoVite from "./vite.svg";
import styles from "./App.module.css";
import { FeatureHub, useFeature } from "featurehub-solid-sdk";

const SAMPLE_TEXT = "This is some random text content which may have its case-sensitivity modified.";

/*
  DEVELOPER NOTE:
  If making changes to the FeatureHub Solid SDK implementation, there is a convenience npm script that
  is part of this example project "npm run install-sdk" that will allow you to make changes to the
  SDK and regenerate the lib source files for this example to install and then use.

  This should hopefully save you time from going back and forth having to package everything for the SDK
  within its own local directory to then come back here and run things again.
*/

function App() {
  const [userKey, setUserKey] = createSignal("");

  setTimeout(() => {
    console.log("ASSIGNING USER AFTER DELAY!");
    // Set username after arbitrary delay to make sure FeatureHub component reconfigures its internals properly.
    setUserKey("john.doe");
  }, 1000);

  return (
    /*
        To run a local instance of FeatureHub for testing, run either of the following commands:
        - docker run -p 8085:8085 --user 999:999 -v $HOME/.featurehub/party/db featurehub/party-server:latest
        - podman run -p 8085:8085 --user 999:999 -v $HOME/.featurehub/party/db featurehub/party-server:latest

        Once you go through the intial setup wizard/guide to create a service account + permissions, 
        go to API Keys for the service account, copy the 'Server eval API key' and paste it into the apiKey prop below.
      */
    <FeatureHub url="http://localhost:8085" apiKey="" userKey={userKey()} pollInterval={5000}>
      <Main />
    </FeatureHub>
  );
}

function Main() {
  const [count, setCount] = createSignal(0);

  /*
    Since <Main> is wrapped by <FeatureHub>, we can then use the supporting useFeature/useFeatureHub hooks!

    This example assumes two features have been created within FeatureHub:
      - Standard boolean "uppercase_text" feature
      - Non-binary string "text_colour" feature

    Make sure they exist when you run your local FeatureHub container instance for this example.
  */

  const shouldUpperCaseText = useFeature("uppercase_text");
  const textColour = useFeature<string>("text_colour");
  const [displayText, setDisplayText] = createSignal(SAMPLE_TEXT);

  createEffect(() => {
    setDisplayText(shouldUpperCaseText() ? SAMPLE_TEXT.toUpperCase() : SAMPLE_TEXT);
  }, [shouldUpperCaseText]);

  return (
    <div class={styles.header}>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={logoVite} class={styles.logo} alt="Vite logo" />
        </a>
        <a href="https://solidjs.com" target="_blank">
          <img src={logoSolid} class={styles.logoSolid} alt="Solid logo" />
        </a>
      </div>
      <h1>Vite + Solid</h1>
      <div class={styles.content}>
        <div class={styles.card}>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>

          <button onClick={() => setCount(count() + 1)}>Count: {count()}</button>

          <p>
            The value of <code>uppercase_text</code> feature is <code>{`${shouldUpperCaseText()}`}</code>
          </p>
          <p>
            The value of <code>text_colour</code> feature is <code>{textColour()}</code>
          </p>

          <p style={{ color: textColour() }}>This paragraph color should be {textColour()}</p>
          <p>{displayText()}</p>
        </div>
        <div>
          <p class={styles.readTheDocs}>Click on the Vite and Solid logos to learn more</p>
        </div>
      </div>
    </div>
  );
}

export default App;
