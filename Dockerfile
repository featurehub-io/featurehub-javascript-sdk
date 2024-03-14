FROM node:18-buster-slim as build

ADD . /app
WORKDIR /app
RUN cd /app/featurehub-javascript-client-sdk && npm install && npm run compile
RUN cd /app/featurehub-javascript-node-sdk  && npm install && npm run setup && npm run compile && npm run link
RUN cd /app/examples/todo-server-tests && npm install && npm run compile
RUN cd /app/examples/todo-backend-typescript && npm install && npm run compile

