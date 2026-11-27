import "./App.css";

import {
  type EvaluationContext,
  useContextMutator,
  useStringFlagDetails,
  useTrack,
} from "@openfeature/react-sdk";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { type Todo, TodoApi } from "./todo_api";

const todoApi = new TodoApi(
  (import.meta.env["VITE_TODO_SERVER_URL"] as string | undefined) || "http://localhost:8099",
);

/**
 * The users you can switch between. Each has their own evaluation context, here and in the backend, which
 * evaluates the todos' titles for the user in the URL (the backend keeps one list of todos for everyone).
 */
export const USERS = ["susan", "bob", "maria"] as const;

/**
 * The OpenFeature context for a user: the same attributes the todo backend evaluates its features with.
 * targetingKey is FeatureHub's user key; country, device and platform are its well-known attributes.
 */
export function userContext(user: string): EvaluationContext {
  return { targetingKey: user, country: "new_zealand", device: "browser", platform: "macos" };
}

function App() {
  const [user, setUser] = useState<string>(USERS[0]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();

  // the provider is registered without a domain, so it is the default context that changes
  const { setContext } = useContextMutator({ defaultContext: true });
  const { track } = useTrack();

  // SUBMIT_COLOR_BUTTON (a string feature) colours the Add button. The hook re-renders this component when
  // the feature changes in FeatureHub, or when the context changes. The details say why it has its value:
  // the reason (TARGETING_MATCH or SPLIT when a rollout strategy matched, STATIC when none did, DISABLED
  // when the feature has no value) and, for a strategy, its id as the variant.
  const buttonColour = useStringFlagDetails("SUBMIT_COLOR_BUTTON", "blue");

  const run = useCallback(async (call: Promise<Todo[]>) => {
    try {
      setTodos(await call);
      setError(undefined);
    } catch (e) {
      setError(`Could not reach the todo server: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void run(todoApi.list(user));
  }, [user, run]);

  const switchUser = (next: string) => {
    setUser(next);
    // re-evaluates every flag for the new user, locally: nothing is fetched from FeatureHub
    void setContext(userContext(next));
  };

  const addTodo = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // a FeatureHub named usage event, sent to the usage plugins on the provider's config
    track("todo-add", { gaValue: 10 });
    void run(todoApi.add(user, title.trim()));
    setTitle("");
  };

  const removeTodo = (id: string) => {
    track("todo-remove", { gaValue: 5 });
    void run(todoApi.remove(user, id));
  };

  return (
    <div className="App">
      <h1>Todo List</h1>

      <div className="users">
        {USERS.map((u) => (
          <button key={u} aria-pressed={u === user} onClick={() => switchUser(u)}>
            {u}
          </button>
        ))}
      </div>

      <form onSubmit={addTodo}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
        />
        <button type="submit" style={{ color: buttonColour.value }}>
          Add
        </button>
      </form>

      <p className="flag">
        <code>SUBMIT_COLOR_BUTTON</code> is <code>{buttonColour.value}</code> for {user} (
        {buttonColour.reason}
        {buttonColour.variant ? `, strategy ${buttonColour.variant}` : ""}
        {buttonColour.errorCode ? `, ${buttonColour.errorCode}` : ""})
      </p>

      {error && <p className="error">{error}</p>}

      <ul>
        {todos.map((todo, index) => (
          <li
            className="qa-main"
            key={`${todo.id}-${index}`}
            style={{ textDecoration: todo.resolved ? "line-through" : "none" }}
          >
            {!todo.resolved && (
              <button
                onClick={() => void run(todoApi.resolve(user, todo.id))}
                className="qa-done-button"
              >
                Done
              </button>
            )}
            <button onClick={() => removeTodo(todo.id)} className="qa-delete-button">
              Delete
            </button>{" "}
            {todo.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
