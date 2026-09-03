FROM node:26.8.1-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development

ENV NODE_ENV=development
COPY . .
EXPOSE 4321
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build

COPY . .
RUN npm run build

FROM node:26.8.1-bookworm-slim AS runtime

ENV NODE_ENV=production
# El adaptador de Astro lee HOST y PORT. Sin HOST=0.0.0.0 el proceso solo
# aceptaría conexiones desde dentro del propio contenedor.
ENV HOST=0.0.0.0
ENV PORT=4321

# tini como PID 1: reenvía SIGTERM al proceso de Node para que `docker stop`
# cierre limpiamente en lugar de esperar diez segundos y matarlo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# El contenedor solo ejecuta `node`: el arranque, el healthcheck, las
# migraciones y el bot. El CLI de npm que trae la imagen base no se usa en
# ejecución y aporta 8 vulnerabilidades con parche (7 HIGH + 1 CRITICAL, entre
# ellas la gzip bomb CVE-2026-59873 de tar). Actualizar Node no las corrige:
# la última de la línea 22 trae el mismo npm 10.9.8. Se elimina el software
# vulnerable en lugar de silenciar el escaneo.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack

COPY --from=build /app/dist ./dist
# `migrations` y `scripts` permiten ejecutar db:pg:migrate y db:seed dentro del
# contenedor; `src` es su dependencia (esquema y capa de datos). No se copia
# drizzle.config.mjs: drizzle-kit es dependencia de desarrollo y no está aquí,
# así que generar migraciones es tarea de la máquina de desarrollo.
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/telegram ./telegram

# Los avatares se sirven desde dist/client. El directorio se crea aquí para
# poder montar encima un volumen persistente con el dueño correcto.
RUN mkdir -p dist/client/avatars && chown -R node:node /app

USER node
EXPOSE 4321

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/entry.mjs"]
