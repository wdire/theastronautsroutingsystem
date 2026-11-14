import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Serves the Vercel edge functions under api/ from the dev server, so keys stay out of the bundle. */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'areo-dev-api',
    configureServer(server) {
      for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const match = /^\/api\/([a-z]+)$/.exec(url.pathname);
        if (!match) return next();
        const file = path.join(root, 'api', `${match[1]}.ts`);
        if (!existsSync(file)) return next();
        try {
          const mod = (await server.ssrLoadModule(file)) as { default: (r: Request) => Promise<Response> };
          const response = await mod.default(new Request(url, { method: req.method ?? 'GET' }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devApi(loadEnv(mode, root, ''))],
  resolve: { alias: { '@': path.join(root, 'src') } },
  worker: { format: 'es' as const },
  build: { target: 'es2023', chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 20000,
  },
}));
