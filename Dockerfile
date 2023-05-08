FROM node:18-buster-slim as build

ADD . /app
WORKDIR /app
RUN cd /app/featurehub-javascript-client-sdk && npm install && npm run compile
RUN cd /app/featurehub-javascript-node-sdk  && npm install && npm run link && npm run compile
RUN cd /app/examples/todo-server-tests && npm install && npm run compile
RUN cd /app/examples/todo-backend-typescript && npm install && npm run compile

