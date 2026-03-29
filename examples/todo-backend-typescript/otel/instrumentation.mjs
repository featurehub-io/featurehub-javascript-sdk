/*instrumentation.mjs*/
import process from "node:process";

import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync("../local.env")) {
  dotenv.config({ path: "../local.env" });
}

if (process.env["OTEL_USAGE_ENABLED"]) {
  process.env["OTEL_SERVICE_NAME"] = "todo-backend-javascript";

  const sdk = new NodeSDK({
    traceExporter: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
      ? undefined
      : new ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}
