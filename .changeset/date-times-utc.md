---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

DATE and DATETIME strategies, and `fhubWhenActive`, now read date-time strings strictly as ISO-8601 and always as UTC: a date-time without an offset (`2021-05-05T10:00:00`) is UTC, rather than the machine's local time, so it matches the same way in every time zone and as FeatureHub Edge does. A string that is not ISO-8601 (`2020-06-15 10:00:00Z`, `15/06/2020`) is not a date-time and never matches. `parseUtcDateTime` is exported for applications that want the same reading.
