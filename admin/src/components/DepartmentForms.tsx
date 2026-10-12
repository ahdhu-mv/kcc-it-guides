"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/client-api";

export function NewDepartmentForm({ free }: { free: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg("");
    const r = await callApi<{ id: number }>("POST", "/api/departments", {
      name: f.get("name"), mode, slug: f.get("slug"), color: f.get("color"), existingSlug: f.get("existingSlug"),
    });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    router.push(`/admin/departments/${r.data.id}?created=1`);
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>Name <input name="name" required maxLength={60} placeholder="e.g. Finance" /></label>
      <label>Category
        <select value={mode} onChange={(e) => setMode(e.target.value as "new" | "existing")}>
          <option value="new">Create a new category</option>
          {free.length > 0 && <option value="existing">Use an existing category</option>}
        </select>
      </label>
      {mode === "new" ? (
        <>
          <label>Folder name <span className="muted">(optional, made from the name)</span>
            <input name="slug" maxLength={60} pattern="[a-z0-9][a-z0-9\-]*" /></label>
          <label>Colour <input type="color" name="color" defaultValue="#0f6b62" /></label>
        </>
      ) : (
        <label>Existing category
          <select name="existingSlug">
            {free.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.slug})</option>)}
          </select>
        </label>
      )}
      {msg && <p className="flash err">{msg}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create department"}</button>
    </form>
  );
}

export function EditDepartmentForm(props: { id: number; name: string; color: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await callApi("PATCH", `/api/departments/${props.id}`, { name: f.get("name"), color: f.get("color") });
    setOk(r.ok); setMsg(r.ok ? "Saved." : r.error);
    if (r.ok) router.refresh();
  }
  return (
    <form onSubmit={submit} className="stack">
      <label>Name <input name="name" defaultValue={props.name} required maxLength={60} /></label>
      <label>Colour <input type="color" name="color" defaultValue={props.color} /></label>
      {msg && <p className={ok ? "flash" : "flash err"}>{msg}</p>}
      <button className="btn" type="submit">Save</button>
    </form>
  );
}

export function AddMembersForm({ id, suggestions }: { id: number; suggestions: { username: string; display_name: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await callApi<{ added: string[] }>("POST", `/api/departments/${id}/members`, { usernames: f.get("usernames") });
    setOk(r.ok);
    setMsg(r.ok ? `Added ${r.data.added.join(", ")}.` : r.error);
    if (r.ok) { form.reset(); router.refresh(); }
  }
  return (
    <form onSubmit={submit} className="stack">
      <label>Add people <span className="muted">(AD sign-in names, separated by spaces or commas)</span>
        <input name="usernames" list="known-users" placeholder="a242775 j.ahmed" autoComplete="off" /></label>
      <datalist id="known-users">
        {suggestions.map((u) => <option key={u.username} value={u.username}>{u.display_name}</option>)}
      </datalist>
      {msg && <p className={ok ? "flash" : "flash err"}>{msg}</p>}
      <button className="btn" type="submit">Add</button>
    </form>
  );
}

export function AddUserToDepartment(props: { username: string; departments: { id: number; name: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await callApi("POST", `/api/users/${encodeURIComponent(props.username)}/department`, { departmentId: Number(f.get("departmentId")) });
    if (r.ok) router.refresh(); else setMsg(r.error);
  }
  return (
    <form onSubmit={submit} className="row">
      <select name="departmentId">{props.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <button className="btn small" type="submit">Add</button>
      {msg && <span className="err-text">{msg}</span>}
    </form>
  );
}
