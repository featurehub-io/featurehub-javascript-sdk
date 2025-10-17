import * as React from "react";
import { Configuration, type Todo, TodoServiceApi } from "./api";
import "./App.css";
import globalAxios from "axios";
import {
  type ClientContext,
  EdgeFeatureHubConfig,
  Readyness,
  fhLog,
} from "featurehub-javascript-client-sdk";

let todoApi: TodoServiceApi;
let initialized = false;
let fhConfig: EdgeFeatureHubConfig;
let fhClient: ClientContext;

const user = "fred";

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

  changeFeaturesUpdated(fu: boolean): TodoData {
    const td = new TodoData(this.todos, this.buttonColour, this.ready);
    td.featuresUpdated = fu;
    return td;
  }
}

class ConfigData {
  todoServerBaseUrl: string = "";
  fhEdgeUrl: string = "";
  fhApiKey: string = "";
}

class App extends React.Component<{}, { todos: TodoData }> {
  private titleInput!: HTMLInputElement;

  constructor() {
    super([]);

    this.state = {
      todos: new TodoData(),
    };
  }

  async initializeFeatureHub() {
    fhLog.trace = (...args: any[]) => {
      console.log(args);
    };
    const config = (await globalAxios.request({ url: "featurehub-config.json" }))
      .data as ConfigData;
    fhConfig = new EdgeFeatureHubConfig(config.fhEdgeUrl, config.fhApiKey);

    // connect to Google Analytics
    // fhConfig.addAnalyticCollector(new GoogleAnalyticsCollector('UA-1234', '1234-5678-abcd-1234'));

    fhClient = await fhConfig.newContext().build();
    fhConfig.repository().addReadynessListener((readyness) => {
      if (!initialized) {
        if (readyness === Readyness.Ready) {
          initialized = true;
          const color = fhClient.getString("SUBMIT_COLOR_BUTTON");
          this.setState({ todos: this.state.todos.changeColor(color) });
        }
      }
    });

    // Using catch & release mechanism
    fhConfig
      .repository()
      .addPostLoadNewFeatureStateAvailableListener(() =>
        this.setState({ todos: this.state.todos.changeFeaturesUpdated(true) }),
      );

    fhConfig.repository().catchAndReleaseMode = true; // catch feature updates and release later

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

  override async componentDidMount() {
    this.initializeFeatureHub();
  }

  async _loadInitialData() {
    const todoResult = (await todoApi.listTodos(user)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  override componentWillUnmount(): void {
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
    const todoResult = (await todoApi.addTodo(user, todo)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  async removeToDo(id: string) {
    fhClient.logAnalyticsEvent("todo-remove", new Map([["gaValue", "5"]]));
    const todoResult = (await todoApi.removeTodo(user, id)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  async doneToDo(id: string) {
    const todoResult = (await todoApi.resolveTodo(user, id)).data;
    this.setState({ todos: this.state.todos.changeTodos(todoResult) });
  }

  override render() {
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
            <button
              onClick={async () => {
                await fhConfig.repository().release();
                const newColor = fhClient.getString("SUBMIT_COLOR_BUTTON");
                this.setState({ todos: this.state.todos.changeColor(newColor) });
              }}
            >
              REFRESH
            </button>
          </div>
        )}
        <h1>Todo List</h1>
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
          <button type="submit" style={buttonStyle}>
            Add
          </button>
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
