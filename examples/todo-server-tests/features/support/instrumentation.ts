/*instrumentation.ts*/
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

import dotenv from "dotenv";
import fs from "fs";

if (fs.existsSync("../local.env")) {
  dotenv.config({ path: "../local.env" });
} else {
  console.log("No external config found");
}

export const OTEL_ENABLED = process.env["OTEL_USAGE_ENABLED"];

if (OTEL_ENABLED) {
  process.env["OTEL_SERVICE_NAME"] = "todo-server-tests";

  const sdk = new NodeSDK({
    traceExporter: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
      ? undefined
      : new ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}
