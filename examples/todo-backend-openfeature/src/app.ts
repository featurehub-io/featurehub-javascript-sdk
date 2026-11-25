import {
  type EvaluationContext,
  type EvaluationDetails,
  type FlagValue,
  OpenFeature,
  ProviderEvents,
  ProviderStatus,
  StandardResolutionReasons,
} from "@openfeature/server-sdk";
import { Analytics } from "@segment/analytics-node";
import cors from "cors";
import express from "express";
import {
  EdgeFeatureHubConfig,
  type FeatureHubConfig,
  FHLog,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "featurehub-javascript-node-sdk";
import { FeatureHubProvider } from "featurehub-openfeature-node-sdk";
import { RedisSessionStoreUrl } from "featurehub-store-redis";
import { SegmentUsagePlugin } from "featurehub-usage-segment";
import { LocalYamlFeatureStore, LocalYamlValueInterceptor } from "featurehub-yaml-interceptor";
import fs from "fs";
import path from "path";

import type { ITodoApiController } from "./generated-interface";
import { Todo, TodoApiRouter } from "./generated-interface";

FHLog.fhLog.trace = (...args: any) => console.log(new Date().toISOString(), "-", ...args);
FHLog.fhLog.log = (...args: any) => console.log(new Date().toISOString(), "-", ...args);
FHLog.fhLog.warn = (...args: any) => console.warn(new Date().toISOString(), "-", ...args);
FHLog.fhLog.error = (...args: any) => console.error(new Date().toISOString(), "-", ...args);

const connectsToFeatureHub =
  process.env["FEATUREHUB_EDGE_URL"] !== undefined &&
  (process.env["FEATUREHUB_CLIENT_API_KEY"] !== undefined ||
    process.env["FEATUREHUB_SERVER_API_KEY"] !== undefined);

if (!connectsToFeatureHub && !process.env["FEATUREHUB_LOCAL_YAML"]) {
  console.error(
    "You must define the location of your FeatureHub Edge URL in the environment variable FEATUREHUB_EDGE_URL, and your API Key in FEATUREHUB_CLIENT_API_KEY, or a local YAML file of feature values in FEATUREHUB_LOCAL_YAML",
  );
  process.exit(-1);
}

// the FeatureHub config the provider runs on, kept for /health/disconnect
let fhConfig: FeatureHubConfig | undefined;

// The provider reads FEATUREHUB_EDGE_URL, the API key and the connection mode (FEATUREHUB_CONNECT_TYPE,
// FEATUREHUB_CONNECT_INTERVAL) from the environment. The config factory attaches the stores, interceptors
// and usage plugins.
const provider = new FeatureHubProvider({
  configFactory: ({ host, apiKey }) => {
    let config: FeatureHubConfig;

    if (host && apiKey) {
      config = new EdgeFeatureHubConfig(host, apiKey);

      // several processes can share one copy of the features, and start with them
      if (process.env["FEATUREHUB_REDIS_URL"]) {
        FHLog.fhLog.trace(`registering for redis`);
        new RedisSessionStoreUrl(process.env["FEATUREHUB_REDIS_URL"], config, {
          refreshTimeout: parseInt(process.env["FEATUREHUB_REDIS_POLL_INTERVAL"] || "3"),
        });
      }
    } else {
      // no FeatureHub: the features come from the YAML file (FEATUREHUB_LOCAL_YAML), and its values are
      // picked up as they are edited
      config = new EdgeFeatureHubConfig();
      new LocalYamlFeatureStore(config);
      config.addValueInterceptor(new LocalYamlValueInterceptor(null, { watchForChanges: true }));
    }

    // if a Segment key is defined, evaluations and tracked events go to Segment
    if (process.env["SEGMENT_WRITE_KEY"] && process.env["SEGMENT_ENABLED"]) {
      console.log("configuring Segment plugin");
      const analytics = new Analytics({ writeKey: process.env["SEGMENT_WRITE_KEY"] });
      config.addUsagePlugin(new SegmentUsagePlugin(() => analytics));
    }

    fhConfig = config;
    return config;
  },
});

const client = OpenFeature.getClient();

client.addHandler(ProviderEvents.Ready, () => console.log("FeatureHub features are available"));
client.addHandler(ProviderEvents.Stale, () =>
  console.warn("FeatureHub will send no more updates: serving the last features"),
);
client.addHandler(ProviderEvents.Error, (details) =>
  console.error("FeatureHub failed to start", details?.message),
);

// the server starts at once and reports readiness through its health check, as the SDK example does
OpenFeature.setProvider(provider);

const app = express();

const healthy = (_req: express.Request, res: express.Response) => {
  if (client.providerStatus === ProviderStatus.READY) {
    res.status(200).send("ok");
  } else {
    res.status(500).send("not ready");
  }
};

app.get("/health/liveness", healthy);
app.get("/health/readiness", healthy);

// used when we want to rely only on the backing store
app.get("/health/disconnect", (_, res) => {
  fhConfig?.closeEdge();
  res.status(200).send("ok");
});

app.use(
  cors({
    origin: "*",
    allowedHeaders: ["content-type"],
    exposedHeaders: [],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "todo-frontend")));

const port = process.env["TODO_PORT"] || 8099;
let todos: Todo[] = [];

/** the feature exists and has a value (the SDK's isSet) */
function isSet<T extends FlagValue>(details: EvaluationDetails<T>): boolean {
  return details.errorCode === undefined && details.reason !== StandardResolutionReasons.DISABLED;
}

class TodoController implements ITodoApiController {
  async resolveTodo(parameters: { id: string; user: string }): Promise<Array<Todo>> {
    const todo: Todo | undefined = todos.find((todo) => todo.id === parameters.id);
    if (!todo) {
      throw new Error("Todo not found");
    }
    todo.resolved = true;
    return this.listTodos(this.context(parameters.user));
  }

  async removeTodo(parameters: { id: string; user: string }): Promise<Array<Todo>> {
    const context = this.context(parameters.user);
    client.track("todo-remove", context, { gaValue: "5" });
    const index: number = todos.findIndex((todo) => todo.id === parameters.id);
    todos.splice(index, 1);
    return this.listTodos(context);
  }

  async addTodo(parameters: { body?: Todo; user: string }): Promise<Array<Todo>> {
    try {
      const context = this.context(parameters.user);
      if (!parameters.body) {
        throw new Error("Todo body is required");
      }

      client.track("todo-add", context, { gaValue: "10" });

      const todo: Todo = {
        id: Math.floor(Math.random() * 20).toString(),
        title: parameters.body.title,
        resolved: false,
      };

      todos = [todo, ...todos];
      return this.listTodos(context);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  private async listTodos(context: EvaluationContext): Promise<Array<Todo>> {
    const newTodoList: Todo[] = [];
    for (const t of todos) {
      newTodoList.push({
        id: t.id,
        resolved: t.resolved,
        title: await this.processTitle(t.title, context),
      });
    }
    return newTodoList;
  }

  async processTitle(title: string, context: EvaluationContext): Promise<string> {
    const featureString = await client.getStringDetails("FEATURE_STRING", "", context);
    if (isSet(featureString) && title == "buy") {
      title = `${title} ${featureString.value}`;
      console.log("Processes string feature", title);
    }

    const featureNumber = await client.getNumberDetails("FEATURE_NUMBER", 0, context);
    if (isSet(featureNumber) && title == "pay") {
      title = `${title} ${featureNumber.value.toString()}`;
      console.log("Processed number feature", title);
    }

    const featureJson = await client.getObjectDetails("FEATURE_JSON", {}, context);
    if (isSet(featureJson) && title == "find") {
      const json = featureJson.value as Record<string, unknown>;
      title = `${title} ${json["foo"]}`; // expecting {"foo":"bar"}
      console.log("Processed JSON feature", title);
    }

    if (await client.getBooleanValue("FEATURE_TITLE_TO_UPPERCASE", false, context)) {
      title = title?.toUpperCase();
      console.log("Processed boolean feature", title);
    }
    return title;
  }

  /**
   * The evaluation context for a request. For demo purposes, this is assuming we know the user location is
   * New Zealand, their device type is browser and the platform is MacOS. In a real application these would
   * come from the user, e.g. `country: user.country` - the well-known keys take the enums' string values
   * ("new_zealand", "browser", "macos").
   */
  context(user: string): EvaluationContext {
    return {
      targetingKey: user,
      country: StrategyAttributeCountryName.NewZealand,
      device: StrategyAttributeDeviceName.Browser,
      platform: StrategyAttributePlatformName.Macos,
    };
  }

  async getTodos(parameters: { user: string }): Promise<Array<Todo>> {
    return this.listTodos(this.context(parameters.user));
  }

  async removeTodos(_parameters: { user: string }): Promise<Array<Todo>> {
    return todos.splice(0, todos.length);
  }
}

const todoRouter = new TodoApiRouter(app, () => new TodoController());

todoRouter.registerRoutes();

// Catch-all handler: send back React's index.html file for client-side routing
// Fixed for Express 5.x: wildcard "*" must be named "/*splat"
app.get("/*splat", (_req, res) => {
  const indexPath = path.join(__dirname, "todo-frontend", "index.html");

  // Check if frontend exists, otherwise send API-only message
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("[FeatureHub OpenFeature API Server]: Frontend not built");
  }
});

process.on("SIGINT", async () => {
  console.log("closing OpenFeature");
  await OpenFeature.close();
  process.exit(0);
});

app.listen(port, function () {
  console.log("server is listening on port", port);
});
