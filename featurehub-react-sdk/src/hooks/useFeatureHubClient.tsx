import { useContext } from "react"
import { FeatureHubContext } from "../components/FeatureHub"
import { ClientContext } from "featurehub-javascript-client-sdk"

/**
 * Fetches the FeatureHub client context object
 * @returns {ClientContext} - the FeatureHub client
 */
function useFeatureHubClient(): ClientContext {
  const client = useContext(FeatureHubContext)

  if (!client) {
    throw new Error(
      "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
    )
  }

  return client
}

export default useFeatureHubClient;
