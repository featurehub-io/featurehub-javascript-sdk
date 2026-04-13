import { FeatureHub as fh } from "featurehub-javascript-client-sdk";
import { useContext } from "react";

import { FeatureHubContext, type UseFeatureHub } from "../components/FeatureHub";

/**
 * Fetches the FeatureHub config and client context objects
 * @returns {UseFeatureHub} - struct containing the FeatureHub config and client
 */
function useFeatureHub(): UseFeatureHub {
  const fhClient = useContext(FeatureHubContext);

  if (fhClient) return fhClient;

  if (!fhClient && fh.isCompletelyConfigured()) {
    return {
      config: fh.config,
      client: fh.context,
    } as UseFeatureHub;
  }

  throw new Error(
    "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
  );
}

export default useFeatureHub;
