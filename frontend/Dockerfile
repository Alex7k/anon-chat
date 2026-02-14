FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_SOCKET_PATH=/api/socket.io
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_PATH=$VITE_SOCKET_PATH

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build-only

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
