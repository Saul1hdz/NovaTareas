import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  // Sin esto el servidor compilado escucha en localhost:8080 —el valor por
  // defecto del adaptador— y dentro de un contenedor queda inalcanzable desde
  // fuera. HOST y PORT del entorno siguen teniendo prioridad.
  server: {
    host: true,
    port: Number(process.env.PORT) || 4321,
  },
  // El chequeo de origen de Astro está activado por defecto, pero solo cubre
  // las peticiones de formulario. Se declara aquí para que sea visible y no
  // dependa de un valor por defecto que podría cambiar de versión; el control
  // fail-closed de las mutaciones con cookie está en src/middleware.js.
  security: {
    checkOrigin: true,
  },

  vite: {
    ssr: {
      external: ['node:fs', 'node:path', 'node:crypto'],
    },
  },
});
