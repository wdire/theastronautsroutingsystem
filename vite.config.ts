import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const DEV_CACHE = path.join(root, 'tools/.cache/api');

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
        // Answers that say they never change are kept on disk, so a second visit does not ask USGS again.
        const key = createHash('sha1').update(url.pathname + url.search).digest('hex');
        const cached = path.join(DEV_CACHE, `${key}.bin`);
        if (existsSync(cached)) {
          const { status, headers, body } = JSON.parse(readFileSync(`${cached}.json`, 'utf8')) as { status: number; headers: Record<string, string>; body?: never };
          void body;
          res.statusCode = status;
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          res.end(readFileSync(cached));
          return;
        }
        try {
          const mod = (await server.ssrLoadModule(file)) as { GET?: (r: Request) => Promise<Response>; default?: (r: Request) => Promise<Response> };
          const handler = mod.GET ?? mod.default;
          if (!handler) return next();
          const response = await handler(new Request(url, { method: req.method ?? 'GET' }));
          const body = Buffer.from(await response.arrayBuffer());
          const headers: Record<string, string> = {};
          response.headers.forEach((value, k) => (headers[k] = value));
          if ((headers['cache-control'] ?? '').includes('immutable')) {
            mkdirSync(DEV_CACHE, { recursive: true });
            writeFileSync(cached, body);
            writeFileSync(`${cached}.json`, JSON.stringify({ status: response.status, headers }));
          }
          res.statusCode = response.status;
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          res.end(body);
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
  resolve: { alias: { '@': path.join(root, 'src'), postprocessing: path.join(root, 'src/lib/shims/postprocessing.ts') } },
  // The data tools write thousands of files under public/; they must not reload the page.
  server: { watch: { ignored: ['**/public/region/**', '**/public/data/**', '**/public/models/**', '**/tools/**', '**/docs/**'] } },
  worker: { format: 'es' as const },
  // Named up front so the dev server never re-bundles dependencies in the middle of a session.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'zustand', 'zustand/middleware', 'radix-ui', 'lucide-react', 'sonner', 'vaul', 'clsx', 'tailwind-merge', 'class-variance-authority', 'maplibre-gl', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'three', 'three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/libs/meshopt_decoder.module.js', 'three/examples/jsm/utils/SkeletonUtils.js', 'three/examples/jsm/utils/BufferGeometryUtils.js', 'three/examples/jsm/postprocessing/EffectComposer.js', 'three/examples/jsm/postprocessing/SMAAPass.js', 'three/examples/jsm/postprocessing/OutputPass.js', 'three/examples/jsm/environments/RoomEnvironment.js', 'n8ao'],
  },
  build: { target: 'es2023', chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 20000,
  },
}));
