import cors from "cors";
import express from "express";
import {
  type ClientContext,
  EdgeFeatureHubConfig,
  featurehubMiddleware,
  FeatureHubPollingClient,
  FHLog,
  Readyness,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "featurehub-javascript-node-sdk";
import fs from "fs";
import path from "path";

import type { ITodoApiController } from "./generated-interface";
import { Todo, TodoApiRouter } from "./generated-interface";

if (
  process.env["FEATUREHUB_EDGE_URL"] === undefined ||
  process.env["FEATUREHUB_CLIENT_API_KEY"] === undefined
) {
  console.error(
    "You must define the location of your FeatureHub Edge URL in the environment variable FEATUREHUB_EDGE_URL, and your API Key in FEATUREHUB_CLIENT_API_KEY",
  );
  process.exit(-1);
}

//provide EDGE_URL, e.g. 'http://localhost:8553/'
//provide API_KEY, e.g. default/ff8635ef-ed28-4cc3-8067-b9ffd8882100/lOopBkGPALBcI0p6AGpf4jAdUi2HxR0RkhYvV00i1XsMQLWkltaoFvEfs7uFsZaQ45kF5FmhGE7rWTSg'

FHLog.fhLog.trace = (...args: any) => console.log(args);
const fhConfig = new EdgeFeatureHubConfig(
  process.env["FEATUREHUB_EDGE_URL"]!,
  process.env["FEATUREHUB_CLIENT_API_KEY"]!,
);

fhConfig.addReadinessListener((_ready, _firstTime) => {}, true);

if (process.env["FEATUREHUB_POLLING_INTERVAL"]) {
  fhConfig.edgeServiceProvider(
    (repo, config) =>
      new FeatureHubPollingClient(
        repo,
        config,
        parseInt(process.env["FEATUREHUB_POLLING_INTERVAL"]!),
      ),
  );
}

// Add override to use polling client
// const FREQUENCY = 5000; // 5 seconds
// fhConfig.edgeServiceProvider((repo, config) => new FeatureHubPollingClient(repo, config, FREQUENCY));

fhConfig.init();

// Connect to GA
// fhConfig.addAnalyticCollector(new GoogleAnalyticsCollector('UA-XXXYYYYY', '1234-5678-abcd-1234'));

const app = express();

app.get("/health/liveness", (_req, res) => {
  if (fhConfig.readyness === Readyness.Ready) {
    res.status(200).send("ok");
  } else {
    res.status(500).send("not ready");
  }
});

app.use(
  cors({
    origin: "*",
    allowedHeaders: ["baggage", "content-type"],
    exposedHeaders: [],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(featurehubMiddleware(fhConfig.repository()));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "todo-frontend")));

const port = process.env["TODO_PORT"] || 8099;
let todos: Todo[] = [];

class TodoController implements ITodoApiController {
  constructor(private readonly req: any) {}

  async resolveTodo(parameters: { id: string; user: string }): Promise<Array<Todo>> {
    const todo: Todo | undefined = todos.find((todo) => todo.id === parameters.id);
    if (!todo) {
      throw new Error("Todo not found");
    }
    todo.resolved = true;
    return this.listTodos(await this.ctx(parameters.user));
  }

  async removeTodo(parameters: { id: string; user: string }): Promise<Array<Todo>> {
    const ctx = await this.ctx(parameters.user);
    ctx.logAnalyticsEvent("todo-remove", new Map([["gaValue", "5"]]));
    const index: number = todos.findIndex((todo) => todo.id === parameters.id);
    todos.splice(index, 1);
    return this.listTodos(ctx);
  }

  async addTodo(parameters: { body?: Todo; user: string }): Promise<Array<Todo>> {
    try {
      const ctx = await this.ctx(parameters.user);
      if (!parameters.body) {
        throw new Error("Todo body is required");
      }

      ctx.logAnalyticsEvent("todo-add", new Map([["gaValue", "10"]]));

      const todo: Todo = {
        id: Math.floor(Math.random() * 20).toString(),
        title: parameters.body.title,
        resolved: false,
      };

      todos = [todo, ...todos];
      return this.listTodos(ctx);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  private listTodos(ctx: ClientContext): Array<Todo> {
    const newTodoList: Todo[] = [];
    todos.forEach((t) => {
      const newT: Todo = { id: "", title: "", resolved: false };
      newT.id = t.id;
      newT.resolved = t.resolved;
      newT.title = this.processTitle(t.title, ctx);
      newTodoList.push(newT);
    });
    return newTodoList;
  }

  processTitle(title: string, ctx: ClientContext) {
    if (ctx.isSet("FEATURE_STRING") && title == "buy") {
      title = `${title} ${ctx.getString("FEATURE_STRING")}`;
      console.log("Processes string feature", title);
    }

    if (ctx.isSet("FEATURE_NUMBER") && title == "pay") {
      const num = ctx.getNumber("FEATURE_NUMBER");
      if (num !== undefined) {
        title = `${title} ${num.toString()}`;
      }
      console.log("Processed number feature", title);
    }

    if (ctx.isSet("FEATURE_JSON") && title == "find") {
      const json = ctx.getJson("FEATURE_JSON");
      title = `${title} ${json["foo"]}`; // expecting {"foo":"bar"}
      console.log("Processed JSON feature", title);
    }

    if (ctx.isEnabled("FEATURE_TITLE_TO_UPPERCASE")) {
      title = title?.toUpperCase();
      console.log("Processed boolean feature", title);
    }
    return title;
  }

  async ctx(user: string): Promise<ClientContext> {
    /** For demo purposes, this is assuming we know the user location is New Zealand
	 their device type is browser
	 and the platform is MacOS.

	 In prod applications these attributes would be variables, e.g. property on the user object: User.country
	 You will have to convert them to Strategy Attribute enums, e.g. country enums
			var country = User.country;
			let enumedCountry: StrategyAttributeCountryName;
			if (country == 'new_zealand') {
				enumedCountry = StrategyAttributeCountryName.NewZealand;
			}
		  return fhConfig.newContext()
		  .userKey(User.key)
		  .country(enumedCountry)
		  .build();
	  **/

    return fhConfig
      .newContext(
        process.env["FEATUREHUB_ACCEPT_BAGGAGE"] !== undefined ? this.req.featureHub : null,
        fhConfig.edgeServiceProvider(),
      )
      .userKey(user)
      .country(StrategyAttributeCountryName.NewZealand)
      .device(StrategyAttributeDeviceName.Browser)
      .platform(StrategyAttributePlatformName.Macos)
      .build();
  }

  async getTodos(parameters: { user: string }): Promise<Array<Todo>> {
    return this.listTodos(await this.ctx(parameters.user));
  }

  async removeTodos(_parameters: { user: string }): Promise<Array<Todo>> {
    return todos.splice(0, todos.length);
  }
}

const todoRouter = new TodoApiRouter(app, (req: any) => new TodoController(req));

todoRouter.registerRoutes();

// Catch-all handler: send back React's index.html file for client-side routing
// Fixed for Express 5.x: wildcard "*" must be named "/*splat"
app.get("/*splat", (_req, res) => {
  const indexPath = path.join(__dirname, "todo-frontend", "index.html");

  // Check if frontend exists, otherwise send API-only message
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("[FeatureHub API Server]: Frontend not built");
  }
});

process.on("SIGINT", () => {
  console.log("closing FH client");
  fhConfig.close();
  process.exit(0);
});

app.listen(port, function () {
  console.log("server is listening on port", port);
});
