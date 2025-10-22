import "./App.css";

import { FeatureHub, useFeature, useFeatureHub } from "featurehub-react-sdk";
import { useEffect, useState } from "react";

import reactLogo from "./assets/react.svg";

const SAMPLE_TEXT =
  "This is some random text content which may have its case-sensitivity modified.";

/*
  DEVELOPER NOTE:
  If making changes to the FeatureHub React SDK implementation, there is a convenience npm script that
  is part of this example project "npm run install-sdk" that will allow you to make changes to the
  SDK and regenerate the lib source files for this example to install and then use.

  This should hopefully save you time from going back and forth having to package everything for the SDK
  within its own local directory to then come back here and run things again.
*/

function App() {
  const [userKey, setUserKey] = useState("");

  useEffect(() => {
    setTimeout(() => {
      // Set username after arbitrary delay to make sure FeatureHub component reconfigures its internals properly.
      setUserKey("john.doe");
    }, 1000);
  }, []);

  return (
    /*
        To run a local instance of FeatureHub for testing, run either of the following commands:
        - docker run -p 8085:8085 --user 999:999 -v $HOME/.featurehub/party/db featurehub/party-server:latest
        - podman run -p 8085:8085 --user 999:999 -v $HOME/.featurehub/party/db featurehub/party-server:latest

        Once you go through the intial setup wizard/guide to create a service account + permissions,
        go to API Keys for the service account, copy the 'Server eval API key' and paste it into the apiKey prop below.
      */
    <FeatureHub url="http://localhost:8085" apiKey="" userKey={userKey} pollInterval={5000}>
      <Main />
    </FeatureHub>
  );
}

function Main() {
  const [count, setCount] = useState(0);
  const { client: fhContext } = useFeatureHub();

  /*
    Since <Main> is wrapped by <FeatureHub>, we can then use the supporting useFeature/useFeatureHubClient hooks!

    This example assumes two features have been created within FeatureHub:
      - Standard boolean "uppercase_text" feature
      - Non-binary string "text_colour" feature

    Make sure they exist when you run your local FeatureHub container instance for this example.
  */

  const shouldUpperCaseText = useFeature("uppercase_text");
  const textColour = useFeature<string>("text_colour");
  const [displayText, setDisplayText] = useState(SAMPLE_TEXT);

  useEffect(() => {
    setDisplayText(shouldUpperCaseText ? SAMPLE_TEXT.toUpperCase() : SAMPLE_TEXT);
  }, [shouldUpperCaseText]);

  return (
    <div className="App">
      <div>
        <a href="https://vitejs.dev" target="_blank" rel="noreferrer">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://reactjs.org" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>

        <button onClick={() => setCount(count + 1)}>Count: {count}</button>

        <button
          onClick={() => {
            fhContext.userKey(Math.random().toString());
            fhContext.build();
          }}
        >
          Change user key
        </button>

        <p>
          The value of <code>uppercase_text</code> feature is{" "}
          <code>{`${shouldUpperCaseText}`}</code>
        </p>
        <p>
          The value of <code>text_colour</code> feature is <code>{textColour}</code>
        </p>

        <p style={{ color: textColour }}>This paragraph color should be {textColour}</p>
        <p>{displayText}</p>
      </div>
      <p className="read-the-docs">Click on the Vite and React logos to learn more</p>
    </div>
  );
}

export default App;
