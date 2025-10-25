import type { Express, Request, Response } from "express";

export class Todo {
  "id": string;
  "title": string;
  "resolved": boolean;
}

export interface ITodoApiController {
  resolveTodo(parameters: { user: string; id: string }): Promise<Array<Todo>>;
  removeTodo(parameters: { user: string; id: string }): Promise<Array<Todo>>;
  removeTodos(parameters: { user: string }): Promise<Array<Todo>>;
  addTodo(parameters: { user: string; body?: Todo }): Promise<Array<Todo>>;
  getTodos(parameters: { user: string }): Promise<Array<Todo>>;
}

export type ControllerHandler = (req: Request) => ITodoApiController;

export class TodoApiRouter {
  private readonly app: Express;

  private controllerFunc: ControllerHandler;

  constructor(app: Express, controllerFunc: ControllerHandler) {
    this.app = app;
    this.controllerFunc = controllerFunc;
  }

  registerRoutes() {
    // Register more specific routes first (with more path segments)
    this.app.put("/todo/:user/:id/resolve", (req: Request, res: Response) => {
      this.controllerFunc(req)
        .resolveTodo({
          user: req.params["user"] || "",
          id: req.params["id"] || "",
        })
        .then((result) => {
          res.send(result);
        })
        .catch(() => {
          res.status(500).send("Internal Server Error");
        });
    });

    this.app.delete("/todo/:user/:id", (req: Request, res: Response) => {
      this.controllerFunc(req)
        .removeTodo({
          user: req.params["user"] || "",
          id: req.params["id"] || "",
        })
        .then((result) => {
          res.send(result);
        })
        .catch(() => {
          res.status(500).send("Internal Server Error");
        });
    });

    // Register less specific routes last
    this.app.delete("/todo/:user", (req: Request, res: Response) => {
      this.controllerFunc(req)
        .removeTodos({
          user: req.params["user"] || "",
        })
        .then((result) => {
          res.send(result);
        })
        .catch(() => {
          res.status(500).send("Internal Server Error");
        });
    });

    this.app.post("/todo/:user", (req: Request, res: Response) => {
      this.controllerFunc(req)
        .addTodo({
          user: req.params["user"] || "",
          body: req.body,
        })
        .then((result) => {
          res.send(result);
        })
        .catch(() => {
          res.status(500).send("Internal Server Error");
        });
    });

    this.app.get("/todo/:user", (req: Request, res: Response) => {
      this.controllerFunc(req)
        .getTodos({ user: req.params["user"] || "" })
        .then((result) => {
          res.send(result);
        })
        .catch(() => {
          res.status(500).send("Internal Server Error");
        });
    });
  }
}
