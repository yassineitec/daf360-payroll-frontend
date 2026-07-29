FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
# .npmrc carries the GitHub Packages auth for @khalilrebhiitec/daf360 —
# without it `npm ci` cannot resolve the design-system package.
COPY .npmrc ./
RUN npm ci --legacy-peer-deps
COPY . .
# native-federation's ng build emits dist then hangs (the esbuild watch never
# exits). Killing it on a fixed timeout can stop it BEFORE styles.css is
# written, shipping a remote with no stylesheet → unstyled/no-colour remote
# inside the shell. Instead: build in the background, wait until BOTH
# remoteEntry.json AND a non-empty styles.css exist (or the build process
# exits), then stop it — and fail loudly if either artefact is missing.
RUN set -e; \
    out=dist/daf360-payroll/browser; \
    npm run build & build_pid=$!; \
    for i in $(seq 1 300); do \
      if [ -f "$out/remoteEntry.json" ] && [ -s "$out/styles.css" ]; then break; fi; \
      kill -0 "$build_pid" 2>/dev/null || break; \
      sleep 2; \
    done; \
    kill "$build_pid" 2>/dev/null || true; \
    test -f "$out/remoteEntry.json"; \
    test -s "$out/styles.css"

FROM nginx:alpine
COPY --from=build /app/dist/daf360-payroll/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
