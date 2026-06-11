import { defineConfig, loadEnv, type Plugin } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that intercepts /api/* requests during development and delegates
 * them to the matching API route file's exported handler.
 *
 * Each route file exports `APIRoute` (from createAPIFileRoute) which has a
 * `methods` property: { POST: handler, GET: handler, ... }.
 */
function apiRoutesPlugin(): Plugin {
  const routeMap = new Map<string, string>();

  return {
    name: "api-routes-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        // Normalise the URL to a path (strip query string)
        const pathname = url.split("?")[0];
        const method = (req.method ?? "GET").toUpperCase();

        // Resolve route file from path
        const routeFilePath = resolveRouteFile(pathname);
        if (!routeFilePath) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `No API route for ${pathname}` }));
          return;
        }

        try {
          // Use Vite's SSR loader to import the module
          const mod = await server.ssrLoadModule(routeFilePath);
          const apiRoute = mod.APIRoute;

          if (!apiRoute || !apiRoute.methods) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Route does not export APIRoute" }));
            return;
          }

          const handler = apiRoute.methods[method];
          if (!handler) {
            res.statusCode = 405;
            res.setHeader("Allow", Object.keys(apiRoute.methods).join(", "));
            res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
            return;
          }

          // Build a Web Request from the Node IncomingMessage
          const protocol = "http";
          const host = req.headers.host ?? "localhost:5173";
          const fullUrl = `${protocol}://${host}${url}`;

          // Read body for POST/PUT/PATCH
          let body: BodyInit | undefined;
          if (["POST", "PUT", "PATCH"].includes(method)) {
            const buf = await readBody(req);
            body = new Uint8Array(buf);
          }

          const headers = new Headers();
          for (const [key, val] of Object.entries(req.headers)) {
            if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
          }

          const webRequest = new Request(fullUrl, {
            method,
            headers,
            body,
            // @ts-expect-error duplex needed for streams
            duplex: body ? "half" : undefined,
          });

          const response: Response = await handler({ request: webRequest, params: {} });

          // Write the Web Response back to Node
          res.statusCode = response.status;
          response.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });

          const responseBody = await response.text();
          res.end(responseBody);
        } catch (err) {
          console.error(`[API Route Error] ${method} ${pathname}:`, err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Internal server error",
            }),
          );
        }
      });
    },
  };
}

/** Map a URL pathname to the correct route file path */
function resolveRouteFile(pathname: string): string | null {
  const srcDir = resolve(__dirname, "src/routes");

  // /api/process-batch → api/process-batch.ts
  // /api/batches/process → api/batches.process.ts
  // /api/report-proxy → api/report-proxy.ts
  const knownRoutes: Record<string, string> = {
    "/api/process-batch": resolve(srcDir, "api/process-batch.ts"),
    "/api/batches/process": resolve(srcDir, "api/batches.process.ts"),
    "/api/report-proxy": resolve(srcDir, "api/report-proxy.ts"),
    "/api/check-batch-results": resolve(srcDir, "api/check-batch-results.ts"),
  };

  return knownRoutes[pathname] ?? null;
}

/** Read the raw body from an IncomingMessage */
function readBody(req: import("http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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
      apiRoutesPlugin(),
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
    ssr: {
      noExternal: ["@supabase/supabase-js"],
    },
    build: {
      rollupOptions: {
        input: {
          client: "./index.html",
        },
      },
    },
  };
});
