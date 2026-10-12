/** Wrapper for route handlers: sign-in, CSRF, and friendly JSON errors. */
import { NextResponse } from "next/server";
import { Conflict, GitError, HttpError, ValidationError } from "./errors";
import type { Identity } from "./auth";
import { assertSafeRequest, identify } from "./session";
import { getServices, type Services } from "./services";

export type Ctx<P> = { req: Request; svc: Services; user: Identity; params: P };

const json = (body: object, status = 200) => NextResponse.json(body, { status });

export function api<P = Record<string, never>>(
  handler: (ctx: Ctx<P>) => Promise<Response | object>,
) {
  return async (req: Request, route?: { params: Promise<P> }): Promise<Response> => {
    try {
      const svc = getServices();
      const url = new URL(req.url);
      const session = await identify(svc, req.headers, req.method, url.pathname + url.search);
      if (!session) return json({ error: "Your session has expired. Please sign in again." }, 401);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSafeRequest(svc, req, session.user);
      const params = (route ? await route.params : {}) as P;
      const out = await handler({ req, svc, user: session.user, params });
      return out instanceof Response ? out : json(out);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, title: err.title }, err.status);
      if (err instanceof Conflict) return json({ error: err.message, conflict: true }, 409);
      if (err instanceof ValidationError) return json({ error: err.message }, 400);
      if (err instanceof GitError) {
        console.error("Publish failed:", err.message);
        return json({ error: "Could not publish to GitHub right now. Your text is still here. " +
          "Try again in a minute." }, 502);
      }
      console.error("Unhandled error:", err);
      return json({ error: "Something went wrong on the server. Nothing was changed." }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ValidationError("The request was not understood.");
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
