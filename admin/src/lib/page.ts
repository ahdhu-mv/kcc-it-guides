/** Helpers for server-rendered pages. */
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError } from "./errors";
import { identify, loginUrl, type Session } from "./session";
import { getServices, type Services } from "./services";

export const getSession = cache(async (): Promise<
  { session: Session | null; error: HttpError | null }
> => {
  try {
    return { session: await identify(getServices(), await headers(), "GET", "/"), error: null };
  } catch (err) {
    if (err instanceof HttpError) return { session: null, error: err };
    throw err;
  }
});

export type PageCtx = { svc: Services; session: Session };

/** Run `render` for a signed-in person. Not signed in -> login page; refusals -> returned as an error view. */
export async function guard<T>(
  pathname: string,
  render: (ctx: PageCtx) => Promise<T>,
  onError: (err: HttpError) => T,
): Promise<T> {
  const svc = getServices();
  const { session, error } = await getSession();
  if (error) return onError(error);
  if (!session) redirect(loginUrl(svc, pathname));
  try {
    return await render({ svc, session });
  } catch (err) {
    if (err instanceof HttpError) return onError(err);
    throw err;
  }
}
