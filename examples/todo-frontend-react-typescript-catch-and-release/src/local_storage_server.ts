
export interface Todo {
  /**
   *
   * @type {string}
   * @memberof Todo
   */
  id: string;
  /**
   *
   * @type {string}
   * @memberof Todo
   */
  title?: string;
  /**
   *
   * @type {boolean}
   * @memberof Todo
   */
  resolved?: boolean;
  /**
   *
   * @type {string}
   * @memberof Todo
   */
  when?: string;
}

class TodoLocalApi {
  private sessionKey = '_featurehub_todos';

  public addTodo(todo: Todo, options?: any): Array<Todo> {
    const todos = this.listTodos();

    if (todo?.id === undefined) {
      todo.id = Math.round((Math.random() * 1000000)).toString();
    }

    todos.push(todo);

    window.localStorage.setItem(this.sessionKey, JSON.stringify(todos));

    return todos;
  }

  /**
   *
   * @summary listTodos
   * @param {*} [options] Override http request option.
   * @throws {RequiredError}
   * @memberof DefaultApi
   */
  public listTodos(options?: any): Array<Todo> {
    const data = window.localStorage.getItem(this.sessionKey);

    if (!data) {
      window.localStorage.setItem(this.sessionKey, JSON.stringify([]));
      return [];
    }

    return JSON.parse(data) as Array<Todo>;
  }

  /**
   *
   * @summary removeTodo
   * @param {string} id
   * @param {*} [options] Override http request option.
   * @throws {RequiredError}
   * @memberof DefaultApi
   */
  public removeTodo(id: string, options?: any): Array<Todo> {
    const todos = this.listTodos();
    const found = this.find(todos, id);

    if (found !== -1) {
      todos.splice(found, 1);
      window.localStorage.setItem(this.sessionKey, JSON.stringify(todos));
    }

    return todos;
  }

  /**
   *
   * @summary resolveTodo
   * @param {string} id
   * @param {*} [options] Override http request option.
   * @throws {RequiredError}
   * @memberof DefaultApi
   */
  public resolveTodo(id: string, options?: any): Array<Todo> {
    const todos = this.listTodos();
    const found = this.find(todos, id);
    if (found !== -1) {
      todos[found].resolved = true;
      window.localStorage.setItem(this.sessionKey, JSON.stringify(todos));
    }
    return todos;
  }

  private find(todos: Array<Todo>, id: string): number {

    let found = -1;
    let index = 0;
    while (found === -1 && index < todos.length) {
      if (todos[index].id === id) {
        found = index;
      }
      index ++;
    }
    return found;
  }
}

export const todoApi = new TodoLocalApi();
