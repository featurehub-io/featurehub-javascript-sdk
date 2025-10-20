import type { Request, Server } from "restify";
import * as restify from "restify";

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
  private readonly api: Server;

  private restifyHttpMethods = {
    POST: "post",
    GET: "get",
    DELETE: "del",
    PUT: "put",
  };

  private controllerFunc: ControllerHandler;

  constructor(api: Server, controllerFunc: ControllerHandler) {
    this.api = api;
    this.controllerFunc = controllerFunc;
  }

  registerRoutes() {
    (this.api as any)[this.restifyHttpMethods["PUT"]](
      "/todo/{user}/{id}/resolve".replace(/{(.*?)}/g, ":$1"),
      (req: restify.Request, res: restify.Response, next: restify.Next) => {
        this.controllerFunc(req)
          .resolveTodo({
            user: req.params["user"],
            id: req.params["id"],
          })
          .then((result) => {
            res.send(result);
            next();
          })
          .catch(() => {
            res.send(500);
            next();
          });
      },
    );
    (this.api as any)[this.restifyHttpMethods["DELETE"]](
      "/todo/{user}/{id}".replace(/{(.*?)}/g, ":$1"),
      (req: restify.Request, res: restify.Response, next: restify.Next) => {
        this.controllerFunc(req)
          .removeTodo({
            user: req.params["user"],
            id: req.params["id"],
          })
          .then((result) => {
            res.send(result);
            next();
          })
          .catch(() => {
            res.send(500);
            next();
          });
      },
    );
    (this.api as any)[this.restifyHttpMethods["DELETE"]](
      "/todo/{user}".replace(/{(.*?)}/g, ":$1"),
      (req: restify.Request, res: restify.Response, next: restify.Next) => {
        this.controllerFunc(req)
          .removeTodos({
            user: req.params["user"],
          })
          .then((result) => {
            res.send(result);
            next();
          })
          .catch(() => {
            res.send(500);
            next();
          });
      },
    );
    (this.api as any)[this.restifyHttpMethods["POST"]](
      "/todo/{user}".replace(/{(.*?)}/g, ":$1"),
      (req: restify.Request, res: restify.Response, next: restify.Next) => {
        this.controllerFunc(req)
          .addTodo({
            user: req.params["user"],
            body: req.body,
          })
          .then((result) => {
            res.send(result);
            next();
          })
          .catch(() => {
            res.send(500);
            next();
          });
      },
    );
    (this.api as any)[this.restifyHttpMethods["GET"]](
      "/todo/{user}".replace(/{(.*?)}/g, ":$1"),
      (req: restify.Request, res: restify.Response, next: restify.Next) => {
        this.controllerFunc(req)
          .getTodos({ user: req.params["user"] })
          .then((result) => {
            res.send(result);
            next();
          })
          .catch(() => {
            res.send(500);
            next();
          });
      },
    );
  }
}
