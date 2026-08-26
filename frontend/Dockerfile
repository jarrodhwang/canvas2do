FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_BASE_PATH=/
ARG VITE_API_BASE_URL=
ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine AS final
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN mkdir -p /var/www/incos-static/images \
  && chmod -R a+rX /usr/share/nginx/html /var/www/incos-static
EXPOSE 6173
