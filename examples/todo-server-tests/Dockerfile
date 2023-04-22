FROM node:18-buster-slim as build

ADD . /app
WORKDIR /app
RUN npm install && npm run build
EXPOSE 8099




