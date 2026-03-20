

add a public field called canSendAsync into UsagePlugin interface so that the `process` method of UsageAdapter knows it can call send asynchronously (if true) or synchronously (if false). In the DefaultUsagePlugin it should be set to true.  The OpenTelemetryUsagePlugin it should be set to false.
