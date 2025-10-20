import { useContext } from "react";
import { FeatureHubContext, type UseFeatureHub } from "../components/FeatureHub";

/**
 * Fetches the FeatureHub config and client context objects
 * @returns {UseFeatureHub} - struct containing the FeatureHub config and client
 */
function useFeatureHub(): UseFeatureHub {
  const featureHub = useContext(FeatureHubContext);

  if (!featureHub) {
    throw new Error(
      "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
    );
  }

  return featureHub;
}

export default useFeatureHub;
