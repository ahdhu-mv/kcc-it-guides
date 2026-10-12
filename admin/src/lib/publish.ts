import type { Identity } from "./auth";
import type { Services } from "./services";

/** Commit a change to GitHub as the signed-in person. */
export function publishAs<T>(
  svc: Services, user: Identity, message: string, mutate: (root: string) => T | Promise<T>,
): Promise<T> {
  return svc.repo.publish(
    `${message}\n\nEdited by ${user.name} (${user.username}) via KCC Guides Admin`,
    { name: user.name, email: user.email || `${user.username}@users.noreply.kcc.com` },
    mutate,
  );
}
