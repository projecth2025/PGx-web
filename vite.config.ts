import { defineConfig, loadEnv, type Plugin } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { register } from "tsx/esm/api";
import type { IncomingMessage, ServerResponse } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register tsx to enable TypeScript imports in the API dev proxy.
// This only affects the dev server, not the production build.
let tsxRegistered = false;

/**
 * Adds Vercel-compatible methods (status, json, send) to Node's ServerResponse.
 * VercelResponse extends ServerResponse with these chainable helpers.
 */
function patchResponse(res: ServerResponse) {
  const r = res as any;
  if (!r.status) {
    r.status = (code: number) => {
      res.statusCode = code;
      return r;
    };
  }
  if (!r.json) {
    r.json = (data: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return r;
    };
  }
  if (!r.send) {
    r.send = (body: string | Buffer) => {
      res.end(body);
      return r;
    };
  }
  return r;
}

/**
 * Vite dev-server plugin that routes /api/* requests to Vercel Serverless
 * Functions in the api/ directory.  In production, Vercel handles these
 * automatically; this plugin only runs during `vite dev`.
 *
 * Uses Node.js native import() (via tsx) instead of Vite's SSR loader
 * to avoid bundling issues with Node-only packages (busboy, AWS SDK, etc.).
 */
function apiDevPlugin(): Plugin {
  return {
    name: "api-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        // Map /api/process-batch → api/process-batch.ts
        const pathname = url.split("?")[0];
        const functionName = pathname.replace(/^\/api\//, "");
        const filePath = resolve(__dirname, `api/${functionName}.ts`);

        try {
          // Register tsx once to enable .ts imports via Node's native import()
          if (!tsxRegistered) {
            register();
            tsxRegistered = true;
          }
          // Use native Node import() instead of Vite SSR loader.
          const fileUrl = `file://${filePath}`;
          // Bust module cache so edits are picked up without restart
          const mod = await import(/* @vite-ignore */ fileUrl + `?t=${Date.now()}`);
          const handler = mod.default;
          if (typeof handler !== "function") {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: `No default export in ${filePath}` }));
            return;
          }
          // Vercel functions accept (req, res) — patch Node's ServerResponse
          // with Vercel's chainable methods (status, json, send).
          const patchedRes = patchResponse(res);
          await handler(req, patchedRes);
        } catch (err) {
          console.error(`[API Dev Proxy] ${pathname}:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : "Internal server error",
              }),
            );
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load all env vars from .env, .env.local, etc. into process.env
  // so server-side code (Supabase admin, AWS SDK) can read them.
  const env = loadEnv(mode, __dirname, "");
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  return {
    plugins: [
      tailwindcss(),
      apiDevPlugin(),
      TanStackRouterVite({
        autoCodeSplitting: true,
      }),
      react(),
      viteTsconfigPaths(),
    ],
    root: "./",
    resolve: {
      alias: {
        "@": `${__dirname}/src`,
      },
    },
    ssr: {},
    build: {
      rollupOptions: {
        input: {
          client: "./index.html",
        },
      },
    },
  };
});
