Create a OpenTelemetryBaggagePlugin which implements the core UsagePlugin interface.
It should be doing the reverse of the OpenTelemetryFeatureInterceptor and sit in the same codebase.
by setting the fhub baggage field.
If it sees an UsageEventWithFeature it should update a single feature by getting the `feature` directly, if it sees an UsageFeaturesCollection it should update
all of the features using the `featureValues` field. It should use the `key` = key, and `rawValue` for the value. Remember
the `rawValue` can legitimately be undefined. Always make sure the keys are stored in alphabetical order when writing them to fhub in the baggage. This must be called synchronously
but the plugin system (it cannot be called async). It should share any sensible code with the OpenTelemetryFeatureInterceptor and have adequate tests. 
