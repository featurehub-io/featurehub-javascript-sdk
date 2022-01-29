FROM node:lts-buster

RUN apt-get update && apt-get install -y nginx
COPY default_site /etc/nginx/sites-enabled/default

WORKDIR /app
COPY . /app
RUN mv /app/todo-frontend /var/www/html/
RUN cd /app && npm install --production
COPY docker-run.sh /
RUN chmod ugo+x /docker-run.sh
EXPOSE 5000
EXPOSE 8099
ENTRYPOINT /docker-run.sh




