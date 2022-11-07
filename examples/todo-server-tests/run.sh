#!/bin/sh
export FEATUREHUB_CLIENT_API_KEY=0d348e65-677a-4fe6-85f1-a1ab1581faa1/CGWXaO3Cey6yjSobQMxgjdKdzLdli5*ZqH81DhIYuKyuY1TIsYX
export FEATUREHUB_EDGE_URL=http://localhost:8064
export FEATUREHUB_BASE_URL=http://localhost:8903
export APP_SERVER_URL=http://localhost:8099
if [ $# -eq 0 ]
  then
  echo DEBUG=true npm run test
  DEBUG=true npm run test
else
  echo DEBUG=true npm run test -- --tags $1
  DEBUG=true npm run test -- --tags $1
fi

