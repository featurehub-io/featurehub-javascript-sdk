import * as React from "react";
import { Configuration, TodoServiceApi, Todo } from "./api";
import "./App.css";
import globalAxios, { AxiosRequestConfig } from "axios";
import {
  ClientContext,
  EdgeFeatureHubConfig,
  Readyness,
  w3cBaggageHeader,
  FeatureHubPollingClient,
} from "featurehub-javascript-client-sdk";

let todoApi: TodoServiceApi;
let initialized = false;
let fhConfig: EdgeFeatureHubConfig;
let fhClient: ClientContext;
let userName = "fred";

class TodoData {
  todos: Array<Todo>;
  buttonColour: string | undefined;
  ready: boolean = false;
  featuresUpdated: boolean = false;

  constructor(todos?: Array<Todo>, buttonColour?: string, ready?: boolean) {
    this.todos = todos || [];
    this.buttonColour = buttonColour || "blue";
    this.ready = ready || false;
  }

  changeColor(colour: string | undefined): TodoData {
    return new TodoData(this.todos, colour, true);
  }

  changeTodos(todos: Array<Todo>): TodoData {
    return new TodoData(todos, this.buttonColour, this.ready);
  }
}

class ConfigData {
  todoServerBaseUrl: string;
  fhEdgeUrl: string;
  fhApiKey: string;
}

globalAxios.interceptors.request.use(
  function (config: AxiosRequestConfig) {
    if (fhConfig !== undefined) {
      // this requires  a  server evaluation key
      const baggage = w3cBaggageHeader({
        repo: fhConfig.repository(),
        header: config.headers.Baggage,
      });
      // const baggage = w3cBaggageHeader({});
      if (baggage) {
        console.log("baggage is ", baggage);
        config.headers.Baggage = baggage;
      } else {
        console.log("no baggage");
      }
    }
    return config;
  },
  function (error: any) {
    // Do something with request error
    return Promise.reject(error);
  },
);

class App extends React.Component<{}, { todos: TodoData }> {
  private titleInput: HTMLInputElement;
  private userName: HTMLInputElement;

  constructor() {
    super([]);

    this.state = {
      todos: new TodoData(),
    };
  }

  async initializeFeatureHub() {
    if (fhConfig !== undefined) {
      return;
    }
    const config = (await globalAxios.request({ url: "featurehub-config.json" }))
      .data as ConfigData;
    fhConfig = new EdgeFeatureHubConfig(config.fhEdgeUrl, config.fhApiKey);
    window["fhConfig"] = fhConfig;
    window["repository"] = fhConfig.repository();

    // change to the polling client so there is a difference in the keys seen by the UI vs the backend
    fhConfig.edgeServiceProvider((repo, cfg) => new FeatureHubPollingClient(repo, cfg, 10000));
    // if we were using the featurehub-baggage-userstate dependency, we would add this to allow overrides via GUI

    // const ls = new LocalSessionInterceptor();
    // fhConfig.repository().addValueInterceptor(ls);

    // connect to Google Analytics
    // fhConfig.addAnalyticCollector(new GoogleAnalyticsCollector('UA-1234', '1234-5678-abcd-1234'));

    fhClient = await fhConfig.newContext().userKey(userName).build();

    fhConfig.addReadinessListener((readiness) => {
      if (!initialized) {
        if (readiness === Readyness.Ready) {
          initialized = true;
          const color = fhClient.getString("SUBMIT_COLOR_BUTTON");
          this.setState({ todos: this.state.todos.changeColor(color) });
        }
      }
    }, true);

    // Uncomment this if you want to use rollout strategy with a country rule
    // await fhClient
    //     .country(StrategyAttributeCountryName.Australia)
    //     .build();

    // connect to the backend server
    todoApi = new TodoServiceApi(new Configuration({ basePath: config.todoServerBaseUrl }));
    this._loadInitialData(); // let this happen in background

    // react to incoming feature changes in real-time
    fhClient.feature("SUBMIT_COLOR_BUTTON").addListener((fs) => {
      this.setState({ todos: this.state.todos.changeColor(fs.getString()) });
    });
  }

  async componentDidMount() {
    this.initializeFeatureHub();
  }

  async _loadInitialData() {
    const todoResult = (await todoApi.listTodos(userName)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  componentWillUnmount(): void {
    fhConfig.close(); // tidy up
  }

  async addTodo(title: string) {
    const todo: Todo = {
      id: "",
      title,
      resolved: false,
    };

    // Send an event to Google Analytics
    fhClient.logAnalyticsEvent("todo-add", new Map([["gaValue", "10"]]));
    const todoResult = (await todoApi.addTodo(userName, todo)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  async removeToDo(id: string) {
    fhClient.logAnalyticsEvent("todo-remove", new Map([["gaValue", "5"]]));
    const todoResult = (await todoApi.removeTodo(userName, id)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  async doneToDo(id: string) {
    const todoResult = (await todoApi.resolveTodo(userName, id)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  render() {
    if (!this.state.todos.ready) {
      return (
        <div className="App">
          <h1>Waiting for initial features.</h1>
        </div>
      );
    }

    let buttonStyle = {
      color: this.state.todos.buttonColour,
    };

    return (
      <div className="App">
        {this.state.todos.featuresUpdated && (
          <div className="updatedFeatures">
            There are updated features available.
            <button onClick={() => window.location.reload()}>REFRESH</button>
          </div>
        )}
        <h1>Todo List</h1>
        <div className="username">
          <form>
            <span>Name</span>
            <input
              ref={(node) => {
                if (node != null) {
                  this.userName = node; // refresh the
                }
              }}
            />
            <button
              style={buttonStyle}
              onClick={(e) => {
                e.preventDefault();
                userName = this.userName.value;
                fhClient.userKey(this.userName.value).build();
              }}
            >
              Set name
            </button>
          </form>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            this.addTodo(this.titleInput.value);
            this.titleInput.value = "";
          }}
        >
          <input
            ref={(node) => {
              if (node !== null) {
                this.titleInput = node;
              }
            }}
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {this.state.todos.todos.map((todo, index) => {
            return (
              <li
                className="qa-main"
                key={index}
                style={{
                  textDecoration: todo.resolved ? "line-through" : "none",
                }}
              >
                {!todo.resolved && (
                  <button onClick={() => this.doneToDo(todo.id || "")} className="qa-done-button">
                    Done
                  </button>
                )}
                <button onClick={() => this.removeToDo(todo.id || "")} className="qa-delete-button">
                  Delete
                </button>{" "}
                {todo.title}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}

export default App;
