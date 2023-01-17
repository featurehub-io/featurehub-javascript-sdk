import { useContext } from "react";
import { FeatureHubContext } from "../components/FeatureHub";
import { ClientContext } from "featurehub-javascript-client-sdk";

/**
 * @deprecated Use `useFeatureHub` instead.
 * Fetches the FeatureHub client context object
 * @returns {ClientContext} - the FeatureHub client
 */
function useFeatureHubClient(): ClientContext {
  const featureHub = useContext(FeatureHubContext);

  if (!featureHub) {
    throw new Error(
      "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!"
    );
  }

  return featureHub.client;
}

export default useFeatureHubClient;
