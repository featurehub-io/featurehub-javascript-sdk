Create an OpenTelemetryFeatureInterceptor in the featurehub-usage-opentelemetry project which implements the FeatureHubSDK FeatureValueInterceptor interface.
It should use the opentelemetry baggage api, and see if there is an field
called `fhub`. If so, it will be a comma separated list of feature=url-encoded-value fields in alphabetical order. If the feature is
not provided it should return (false,undefined). If overrides are not allowed and the feature is locked, it should return (false,undefined).
If it matches a feature in the list, it should be converted into the type
indicated by the FeatureValueType field of featureState and returned with a (true,value) tuple, otherwise
it should return (false,undefined). It should abort the search early if the key it is looking for is greater alphabetically that the one it is looking at
in the loop.
