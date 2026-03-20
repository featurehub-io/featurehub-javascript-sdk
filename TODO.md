Modify the FeatureStateValueInterceptor and call it a FeatureValueInterceptor in all locations.
remove the InterceptorValueMatch class and have the matched method return a tuple of (boolean,value), where first parameter is
true if it is found, false if it is not found. Add the InternalFeatureRepository as the required second parameter, bumping the featureState to optional third and remove the
"reposository" method in the class. Update all code that calls it and the tests.

Create an OpenTelemetryFeatureValueInterceptor in the featurehub-usage-opentelemetry project which implements the FeatureStateValueInterceptor interface.
It should use the opentelemetry baggage api, and see if there is a field
called `fhub`. If so, it will be a comma separated list (in alphabetical order) of feature=url-encoded-value fields. If the feature is
not provided it should return InterceptorValueMatch(false,null). If overrides are not allowed and the feature is locked, it should return InterceptorValueMatch(false,null).
If it matches a feature in the list, it should be converted into the type
indicated by the FeatureValueType field of featureState and returned with a InterceptorValueMatch(true,value) tuple, otherwise
it should return InterceptorValueMatch(false,null).

add a public field called canSendAsync into UsagePlugin interface so that the `process` method of UsageAdapter knows it can call send asynchronously (if true) or synchronously (if false). In the DefaultUsagePlugin it should be set to true. The OpenTelemetryUsagePlugin it should be set to false.
