#!/bin/sh
export APP_SERVER_URL=http://localhost:8099
if [ $# -eq 0 ]
  then
  echo DEBUG=true npm run test
  DEBUG=true npm run test
else
  echo DEBUG=true npm run test -- --tags $1
  DEBUG=true npm run test -- --tags $1
fi

