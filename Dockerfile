# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
# .npmrc carries the GitHub Packages auth for @khalilrebhiitec/daf360 —
# without it `npm ci` cannot resolve the design-system package.
COPY .npmrc ./
# Le même traitement que les services Maven (--mount=type=cache,target=/root/.m2) : le
# cache npm survit d'un build à l'autre, donc une reconstruction résout depuis le disque
# au lieu de re-télécharger ~1500 archives. Dix images qui se construisent en parallèle
# contre un seul registre, c'est ce qui transformait UNE connexion coupée (ECONNRESET) en
# build raté : sans cache et sans reprise, npm abandonnait tout ce qu'il avait déjà tiré.
#
#   · --mount=type=cache   /root/.npm persiste entre les builds (exige la ligne "syntax="
#                          en tête de fichier). L'id est PARTAGÉ entre les fronts : ils ont
#                          presque le même arbre Angular, autant ne le télécharger qu'une
#                          fois pour tous. cacache est conçu pour les accès concurrents ;
#                          en cas de contention, mettre un id par projet.
#   · --prefer-offline     le cache d'abord, le réseau seulement pour ce qui manque.
#   · fetch-retries 5      le défaut de npm est 2. Une coupure est maintenant reprise avec
#                          un backoff au lieu de faire échouer l'étape.
#   · fetch-timeout 10 min le défaut de 5 min est trop juste quand dix builds se partagent
#                          le même lien montant.
#   · --no-audit/--no-fund deux allers-retours réseau en moins, inutiles ici.
#
# "npm ci" reste "npm ci" : le lock fait toujours foi, donc la raison d'être de cette étape
# (un seul patch @angular/* partagé par le shell et les remotes, sinon NG0203) est intacte.
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=600000
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund
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
