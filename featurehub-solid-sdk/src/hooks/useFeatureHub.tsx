import { useContext } from "solid-js";
import { FeatureHubContext, UseFeatureHub } from "../components/FeatureHub";

/**
 * Fetches the FeatureHub config and client objects
 * @returns {UseFeatureHub} - struct containing both the FeatureHub config and client
 */
function useFeatureHub(): UseFeatureHub {
  const { config, client } = useContext(FeatureHubContext);

  if (!config() || !client()) {
    throw new Error(
      "Error invoking useFeatureHub! Make sure your component is wrapped by the top-level <FeatureHub> component!"
    );
  }

  return { config, client };
}

export default useFeatureHub;
