# ---- build ----
# The tag documents the version; the digest fixes it, since a tag is reassignable.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# After `npm ci` on purpose: this value changes on every release, and placing
# it earlier would reinstall the dependencies for each one.
ARG VITE_BUILD=dev
ENV VITE_BUILD=$VITE_BUILD

COPY . .
RUN npm run build

# ---- serve ----
# Unprivileged variant: listens on 8080 without root. Traefik exposes the
# service, so the port has no reason to be 80.
# The tag documents the version; the digest fixes it, since a tag is reassignable.
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0

# The fragment goes to snippets/ rather than conf.d/: everything under conf.d
# is included automatically at the `http` level, whereas we need to include it
# location by location.
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
