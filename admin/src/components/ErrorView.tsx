import Link from "next/link";
import type { HttpError } from "@/lib/errors";

export function ErrorView({ error }: { error: Pick<HttpError, "status" | "title" | "message"> }) {
  return (
    <section className="card narrow center">
      <p className="code">{error.status}</p>
      <h1>{error.title}</h1>
      <p>{error.message}</p>
      <p><Link className="btn" href="/">Back to my guides</Link></p>
    </section>
  );
}
