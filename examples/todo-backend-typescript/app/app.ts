import * as restify from 'restify';
import * as corsMiddleware from 'restify-cors-middleware2';
import { ITodoApiController, Todo, TodoApiRouter } from "./generated-interface";
import {
  ClientContext,
  EdgeFeatureHubConfig,
  featurehubMiddleware,
  Readyness,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName
} from 'featurehub-javascript-node-sdk';

if (process.env.FEATUREHUB_EDGE_URL === undefined || process.env.FEATUREHUB_CLIENT_API_KEY === undefined) {
	console.error('You must define the location of your FeatureHub Edge URL in the environment variable FEATUREHUB_EDGE_URL, and your API Key in FEATUREHUB_CLIENT_API_KEY');
	process.exit(-1);
}

//provide EDGE_URL, e.g. 'http://localhost:8553/'
//provide API_KEY, e.g. default/ff8635ef-ed28-4cc3-8067-b9ffd8882100/lOopBkGPALBcI0p6AGpf4jAdUi2HxR0RkhYvV00i1XsMQLWkltaoFvEfs7uFsZaQ45kF5FmhGE7rWTSg'

// fhLog.trace = (...args: any) => console.log(args);
const fhConfig = new EdgeFeatureHubConfig(process.env.FEATUREHUB_EDGE_URL, process.env.FEATUREHUB_CLIENT_API_KEY);

fhConfig.addReadinessListener((ready, firstTime) => {

}, true);

// Add override to use polling client
// const FREQUENCY = 5000; // 5 seconds
// fhConfig.edgeServiceProvider((repo, config) => new FeatureHubPollingClient(repo, config, FREQUENCY));

fhConfig.init();

// Connect to GA
// fhConfig.addAnalyticCollector(new GoogleAnalyticsCollector('UA-XXXYYYYY', '1234-5678-abcd-1234'));


const api = restify.createServer();

api.get('/health/liveness', (req, res, next) => {
  if (fhConfig.readyness === Readyness.Ready) {
    res.status(200);
    res.send('ok');
  } else {
    res.send('not ready');
    res.status(500);
  }

  next();
});

const cors = corsMiddleware({origins: ['*'], allowHeaders: ['baggage'], exposeHeaders: []});

api.pre(cors.preflight);
api.use(cors.actual);
api.use(restify.plugins.bodyParser());
api.use(restify.plugins.queryParser());
api.use(featurehubMiddleware(fhConfig.repository()));

const port = process.env.TODO_PORT || 8099;
let todos: Todo[] = [];

class TodoController implements ITodoApiController {
  constructor(private readonly req: any) {}

	async resolveTodo(parameters: { id: string, user: string }): Promise<Array<Todo>> {
		const todo: Todo = todos.find((todo) => todo.id === parameters.id);
		todo.resolved = true;
		return this.listTodos((await this.ctx(parameters.user)));
	}

	async removeTodo(parameters: { id: string, user: string }): Promise<Array<Todo>> {
		const ctx = await this.ctx(parameters.user);
		ctx.logAnalyticsEvent('todo-remove', new Map([['gaValue', '5']]));
		const index: number = todos.findIndex((todo) => todo.id === parameters.id);
		todos.splice(index, 1);
		return this.listTodos(ctx);
	}

	async addTodo(parameters: { body?: Todo, user: string }): Promise<Array<Todo>> {
		try {
			const ctx = await this.ctx(parameters.user);

			ctx.logAnalyticsEvent('todo-add', new Map([['gaValue', '10']]));

			const todo: Todo = {
				id: Math.floor(Math.random() * 20).toString(),
				title: parameters.body.title,
				resolved: false
			};

			todos = [todo, ...todos];
			return this.listTodos(ctx);
		} catch (e) {
			console.error(e);
			throw e;
		}
	}

	private listTodos(ctx: ClientContext): Array<Todo> {
		const newTodoList = [];
		todos.forEach((t) => {
			const newT = new Todo();
			newT.id = t.id;
			newT.resolved = t.resolved;
			newT.title = this.processTitle(t.title, ctx);
			newTodoList.push(newT);
		});
		return newTodoList;
	}

	processTitle(title: string, ctx: ClientContext) {

		if (ctx.isSet('FEATURE_STRING') && title == 'buy') {
			title = `${title} ${ctx.getString('FEATURE_STRING')}`;
			console.log('Processes string feature', title);
		}

		if (ctx.isSet('FEATURE_NUMBER') && title == 'pay') {
			title = `${title} ${ctx.getNumber('FEATURE_NUMBER').toString()}`;
			console.log('Processed number feature', title);
		}

		if (ctx.isSet('FEATURE_JSON') && title == 'find') {
			const json = ctx.getJson('FEATURE_JSON');
			title = `${title} ${json['foo']}`; // expecting {"foo":"bar"}
			console.log('Processed JSON feature', title);
		}

		if (ctx.isEnabled('FEATURE_TITLE_TO_UPPERCASE')) {
			title = title?.toUpperCase();
			console.log('Processed boolean feature', title);

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

		return fhConfig.newContext((process.env.FEATUREHUB_ACCEPT_BAGGAGE !== undefined) ? this.req.featureHub : null, fhConfig.edgeServiceProvider() )
			.userKey(user)
			.country(StrategyAttributeCountryName.NewZealand)
			.device(StrategyAttributeDeviceName.Browser)
			.platform(StrategyAttributePlatformName.Macos)
			.build();
	}

	async getTodos(parameters: {user: string}): Promise<Array<Todo>> {
		return this.listTodos((await this.ctx(parameters.user)));
	}

	async removeTodos(parameters: { user: string }): Promise<Array<Todo>> {
		return todos.splice(0, todos.length);
	}
}

const todoRouter = new TodoApiRouter(api, (req: any) => new TodoController(req));

todoRouter.registerRoutes();

process.on('SIGINT', () => {
	console.log('closing FH client');
	fhConfig.close();
	api.close(() => console.log('Shut down server...'));
	process.exit(0);
});

api.listen(port, function () {
  console.log('server is listening on port', port);
});
