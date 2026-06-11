/**
 * Lightweight API route definition that works without the full Vinxi/TanStack Start framework.
 * Used by the Vite dev server plugin (apiRoutesPlugin in vite.config.ts) and
 * can be replaced with createAPIFileRoute from @tanstack/start-api-routes
 * when the full TanStack Start framework is configured.
 */

export type APIMethodHandler = (ctx: {
  request: Request;
  params: Record<string, string>;
}) => Response | Promise<Response>;

export type APIMethods = Partial<
  Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD", APIMethodHandler>
>;

export interface APIRouteDef<TPath extends string = string> {
  path: TPath;
  methods: APIMethods;
}

/**
 * Create an API file route definition.
 * Compatible with the shape expected by TanStack Start's API route handler.
 */
export function createAPIFileRoute<TPath extends string>(path: TPath) {
  return (methods: APIMethods): APIRouteDef<TPath> => ({
    path,
    methods,
  });
}
