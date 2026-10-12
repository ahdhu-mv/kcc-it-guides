"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/client-api";

/** Two-step destructive button: first click asks, second click does it. */
export function ConfirmButton(props: {
  label: string; confirmText: string; url: string; method?: "DELETE" | "POST";
  after?: string; small?: boolean; danger?: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cls = `btn${props.small ? " small" : ""}`;

  async function run() {
    setBusy(true);
    setError("");
    const r = await callApi(props.method ?? "DELETE", props.url);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (props.after) router.push(props.after); else router.refresh();
  }

  if (!asking) {
    return <button type="button" className={`${cls} ghost`} onClick={() => setAsking(true)}>{props.label}</button>;
  }
  return (
    <span className="row" role="alertdialog" aria-label={props.confirmText}>
      <span className="muted">{props.confirmText}</span>
      <button type="button" className={`${cls} danger`} disabled={busy} onClick={run}>
        {busy ? "Working…" : "Yes, do it"}
      </button>
      <button type="button" className={`${cls} ghost`} disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      {error && <span className="err-text">{error}</span>}
    </span>
  );
}
