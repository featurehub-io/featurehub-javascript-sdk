#/bin/bash
set -e -o pipefail
npm install
npm run build
mkdir -p dist/todo-frontend
cd ../todo-frontend-react-typescript
npm install
npm run compile
cd build && cp -R * ../../todo-backend-typescript/dist/todo-frontend
cd ../../todo-backend-typescript
cp docker-run.sh dist
cp Dockerfile dist
cp default_site dist
cp package.json dist
cd dist
docker build --no-cache -t featurehub/example_node:1.3.0 .
