#!/bin/sh
nginx
echo "{\"todoServerBaseUrl\": \"http://localhost:5000\", \"fhEdgeUrl\": \"$FEATUREHUB_EDGE_URL\", \"fhApiKey\": \"$FEATUREHUB_SERVER_API_KEY\" }" > /var/www/html/todo-frontend/featurehub-config.json
cd /app && node app
