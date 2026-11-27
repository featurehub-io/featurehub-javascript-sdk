/** The todo backend's API (examples/todo-backend-openfeature): every call answers with the user's todos. */
export interface Todo {
  id: string;
  title: string;
  resolved: boolean;
}

export class TodoApi {
  constructor(private readonly baseUrl: string) {}

  list(user: string): Promise<Todo[]> {
    return this.call("GET", user);
  }

  add(user: string, title: string): Promise<Todo[]> {
    return this.call("POST", user, "", { id: "", title, resolved: false });
  }

  resolve(user: string, id: string): Promise<Todo[]> {
    return this.call("PUT", user, `/${encodeURIComponent(id)}/resolve`);
  }

  remove(user: string, id: string): Promise<Todo[]> {
    return this.call("DELETE", user, `/${encodeURIComponent(id)}`);
  }

  private async call(method: string, user: string, path = "", body?: Todo): Promise<Todo[]> {
    const response = await fetch(`${this.baseUrl}/todo/${encodeURIComponent(user)}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      throw new Error(`the todo server answered ${response.status}`);
    }

    return (await response.json()) as Todo[];
  }
}
