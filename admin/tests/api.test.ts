import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createGuide } from "@/app/api/guides/route";
import { DELETE as deleteGuide, PUT as updateGuide } from "@/app/api/guides/[category]/[slug]/route";
import { POST as upload } from "@/app/api/upload/[category]/route";
import { POST as preview } from "@/app/api/preview/route";
import { GET as image } from "@/app/img/[...path]/route";
import { POST as createDepartment } from "@/app/api/departments/route";
import { DELETE as deleteDepartment, PATCH as editDepartment } from "@/app/api/departments/[id]/route";
import { POST as addMembers } from "@/app/api/departments/[id]/members/route";
import { DELETE as removeMember } from "@/app/api/departments/[id]/members/[username]/route";
import { POST as addUserToDept } from "@/app/api/users/[username]/department/route";
import { GET as healthz } from "@/app/healthz/route";
import { accessibleCategories, getCategory } from "@/lib/session";
import { git, lastCommit, makeWorld, ORIGIN, showRemote, ctx, type World } from "./harness";
import { pythonHasBuilder } from "./helpers";

let w: World;
beforeEach(async () => { w = await makeWorld(); });
afterEach(() => w.cleanup());

const GUIDE = { category: "finance", title: "Month end", description: "Close the books", slug: "month-end", body: "## Steps\n\nDo it.\n" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

async function setupDepartments() {
  const adm = w.as("adm");
  for (const [name, slug] of [["Finance", "finance"], ["HR", "hr"]]) {
    const r = await createDepartment(adm.req("POST", "/api/departments", { name, mode: "existing", existingSlug: slug }));
    expect(r.status).toBe(200);
  }
  const fid = w.svc.db.departmentBySlug("finance")!.id;
  const hid = w.svc.db.departmentBySlug("hr")!.id;
  for (const [id, names] of [[fid, "fatima hassan"], [hid, "hawwa"]] as const) {
    const r = await addMembers(adm.req("POST", `/api/departments/${id}/members`, { usernames: names }), ctx({ id: String(id) }));
    expect(r.status).toBe(200);
  }
  return { fid, hid };
}

describe("signing in", () => {
  it("no cookie -> 401", async () => {
    expect((await createGuide(w.as(null).req("POST", "/api/guides", GUIDE))).status).toBe(401);
  });
  it("unknown cookie -> 401", async () => {
    expect((await createGuide(w.as("bogus").req("POST", "/api/guides", GUIDE))).status).toBe(401);
  });
  it("Authelia says forbidden -> 403", async () => {
    expect((await createGuide(w.as("banned").req("POST", "/api/guides", GUIDE))).status).toBe(403);
  });
  it("forged Remote-User headers do nothing", async () => {
    const r = await createGuide(new Request(`${ORIGIN}/api/guides`, {
      method: "POST", headers: { "remote-user": "a242775", "remote-groups": "IT-Staff", "content-type": "application/json" },
      body: JSON.stringify(GUIDE) }));
    expect(r.status).toBe(401);
  });
  it("healthz is open", async () => {
    expect((await healthz()).status).toBe(200);
  });
  it("Authelia down -> 503 with a friendly message", async () => {
    w.cleanup(); // closes the fake server
    w = await makeWorld();
    const cfg = { ...w.svc.cfg, autheliaUrl: "http://127.0.0.1:1" };
    (w.svc as { cfg: typeof cfg }).cfg = cfg;
    const r = await createGuide(w.as("fin").req("POST", "/api/guides", GUIDE));
    expect(r.status).toBe(503);
  });
});

describe("permissions", () => {
  it("members only reach their own category", async () => {
    await setupDepartments();
    const fin = w.as("fin");
    expect((await createGuide(fin.req("POST", "/api/guides", GUIDE))).status).toBe(200);
    expect((await createGuide(fin.req("POST", "/api/guides", { ...GUIDE, category: "hr" }))).status).toBe(403);
    expect((await createGuide(fin.req("POST", "/api/guides", { ...GUIDE, category: "nope" }))).status).toBe(404);
    expect((await createGuide(fin.req("POST", "/api/guides", { ...GUIDE, category: "general" }))).status).toBe(403);
    expect((await upload(fin.req("POST", "/api/upload/hr", new FormData()), ctx({ category: "hr" }))).status).toBe(403);
    expect((await preview(fin.req("POST", "/api/preview", { category: "hr", body: "x" }))).status).toBe(403);
  });
  it("outsiders have nothing", async () => {
    await setupDepartments();
    expect((await createGuide(w.as("nobody").req("POST", "/api/guides", GUIDE))).status).toBe(403);
  });
  it("only admins manage departments and people", async () => {
    const { fid } = await setupDepartments();
    const fin = w.as("fin");
    expect((await createDepartment(fin.req("POST", "/api/departments", { name: "X", mode: "new" }))).status).toBe(403);
    expect((await addMembers(fin.req("POST", `/api/departments/${fid}/members`, { usernames: "fatima" }), ctx({ id: String(fid) }))).status).toBe(403);
    expect((await editDepartment(fin.req("PATCH", `/api/departments/${fid}`, { name: "X", color: "#000000" }), ctx({ id: String(fid) }))).status).toBe(403);
    expect((await deleteDepartment(fin.req("DELETE", `/api/departments/${fid}`), ctx({ id: String(fid) }))).status).toBe(403);
    expect((await addUserToDept(fin.req("POST", "/api/users/fatima/department", { departmentId: fid }), ctx({ username: "fatima" }))).status).toBe(403);
  });
  it("admins reach every category; page helpers agree", async () => {
    await setupDepartments();
    const root = w.svc.repo.dir;
    await w.svc.repo.read(() => undefined);
    const admin = { username: "a242775", name: "A", email: "", groups: [], isAdmin: true };
    const fatima = { username: "fatima", name: "F", email: "", groups: [], isAdmin: false };
    expect(Object.keys(accessibleCategories(w.svc, admin, root)).sort()).toEqual(["finance", "general", "hr"]);
    expect(Object.keys(accessibleCategories(w.svc, fatima, root))).toEqual(["finance"]);
    expect(() => getCategory(w.svc, fatima, root, "hr")).toThrow(/not a member/);
    expect(() => getCategory(w.svc, fatima, root, "constructor")).toThrow(/doesn't exist/);
    expect(() => getCategory(w.svc, fatima, root, "__proto__")).toThrow();
  });
  it("admin group from Authelia also counts", async () => {
    // 'adm' is in IT-Staff and also listed; make sure group alone is enough
    (w.svc.cfg as { adminUsers: Set<string> }).adminUsers = new Set();
    expect((await createDepartment(w.as("adm").req("POST", "/api/departments", { name: "Procurement", mode: "new" }))).status).toBe(200);
  });
});

describe("request safety", () => {
  it("CSRF token required", async () => {
    await setupDepartments();
    expect((await createGuide(w.as("fin").req("POST", "/api/guides", GUIDE, { csrf: false }))).status).toBe(400);
  });
  it("token of another user is rejected", async () => {
    await setupDepartments();
    const fin = w.as("fin");
    const r = await createGuide(fin.req("POST", "/api/guides", GUIDE, { headers: { "x-csrf-token": w.as("hr").token } }));
    expect(r.status).toBe(400);
  });
  it("foreign Origin and cross-site fetches are blocked", async () => {
    await setupDepartments();
    const fin = w.as("fin");
    expect((await createGuide(fin.req("POST", "/api/guides", GUIDE, { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await createGuide(fin.req("POST", "/api/guides", GUIDE, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  });
});

describe("guides", () => {
  it("create, edit, delete — committed as the editor", async () => {
    await setupDepartments();
    const fin = w.as("fin");
    expect((await createGuide(fin.req("POST", "/api/guides", GUIDE))).status).toBe(200);
    const text = showRemote(w.bare, "content/finance/month-end.md")!;
    expect(text).toContain("title: Month end");
    expect(text).toMatch(/updated: \d{4}-\d{2}-\d{2}\n/);
    expect(text).not.toMatch(/updated: ["']/);
    expect(lastCommit(w.bare)).toContain("Fatima Finance|fatima@kcc.com");
    expect(lastCommit(w.bare)).toContain("Edited by Fatima Finance (fatima) via KCC Guides Admin");

    const current = (await w.svc.repo.read(() => undefined, true), fs.readFileSync(path.join(w.svc.repo.dir, "content/finance/month-end.md")));
    const hash = (await import("node:crypto")).createHash("sha256").update(current).digest("hex");
    const up = await updateGuide(fin.req("PUT", "/api/guides/finance/month-end",
      { title: "Month end", description: "d", body: "changed", baseHash: hash }), ctx({ category: "finance", slug: "month-end" }));
    expect(up.status).toBe(200);
    expect(showRemote(w.bare, "content/finance/month-end.md")).toContain("changed");

    const del = await deleteGuide(fin.req("DELETE", "/api/guides/finance/month-end"), ctx({ category: "finance", slug: "month-end" }));
    expect(del.status).toBe(200);
    expect(showRemote(w.bare, "content/finance/month-end.md")).toBeNull();
  });

  it("duplicate address is rejected", async () => {
    await setupDepartments();
    expect((await createGuide(w.as("fin").req("POST", "/api/guides", { ...GUIDE, slug: "invoices" }))).status).toBe(400);
  });

  it("two editors: conflict detected, then 'save anyway'", async () => {
    await setupDepartments();
    const fin = w.as("fin"), fin2 = w.as("fin2");
    const route = ctx({ category: "finance", slug: "invoices" });
    const { createHash } = await import("node:crypto");
    const read = async () => { await w.svc.repo.read(() => undefined, true); return createHash("sha256").update(fs.readFileSync(path.join(w.svc.repo.dir, "content/finance/invoices.md"))).digest("hex"); };
    const base = await read();
    const body = (b: string, h: string, force = false) => ({ title: "Invoices", description: "x", body: b, baseHash: h, force });
    expect((await updateGuide(fin2.req("PUT", "/api/guides/finance/invoices", body("hassan was here", base)), route)).status).toBe(200);
    const r = await updateGuide(fin.req("PUT", "/api/guides/finance/invoices", body("fatima version", base)), route);
    expect(r.status).toBe(409);
    const data = await r.json();
    expect(data.conflict).toBe(true);
    expect(showRemote(w.bare, "content/finance/invoices.md")).toContain("hassan was here");
    const forced = await updateGuide(fin.req("PUT", "/api/guides/finance/invoices", body("fatima version", data.currentHash, true)), route);
    expect(forced.status).toBe(200);
    expect(showRemote(w.bare, "content/finance/invoices.md")).toContain("fatima version");
  });

  it.each(["../hr/evil", "..%2Fhr%2Fevil", "a/b", ".hidden", "x".repeat(200), "CON.md", ""])(
    "path tricks in the guide address are refused: %s", async (slug) => {
      await setupDepartments();
      const r = await createGuide(w.as("fin").req("POST", "/api/guides", { ...GUIDE, title: slug === "" ? "T" : "T", slug }));
      if (slug === "") expect(r.status).toBe(200); // empty means "make one from the title"
      else expect(r.status).toBe(400);
      expect(showRemote(w.bare, "content/hr/evil.md")).toBeNull();
    });

  it("tricky categories and slugs in the URL are refused", async () => {
    await setupDepartments();
    const fin = w.as("fin");
    for (const category of ["..", "../hr", "finance/../hr"]) {
      const r = await deleteGuide(fin.req("DELETE", "/x"), ctx({ category, slug: "invoices" }));
      expect([400, 403, 404]).toContain(r.status);
    }
    const r = await deleteGuide(fin.req("DELETE", "/x"), ctx({ category: "finance", slug: "../../build" }));
    expect(r.status).toBe(400);
    expect(fs.existsSync(path.join(w.svc.repo.dir, "build.py"))).toBe(true);
  });

  it("title/description cannot inject front matter", async () => {
    await setupDepartments();
    const r = await createGuide(w.as("fin").req("POST", "/api/guides", {
      ...GUIDE, slug: "inj", title: "Hi\nupdated: 1999-01-01\nevil: yes", description: "a: b\n---\nfoo" }));
    expect(r.status).toBe(400);
    const r2 = await createGuide(w.as("fin").req("POST", "/api/guides", {
      ...GUIDE, slug: "inj2", title: "Colon: and # hash", description: "multi\nline\n---\nstuff: yes" }));
    expect(r2.status).toBe(200);
    const text = showRemote(w.bare, "content/finance/inj2.md")!;
    const front = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(text)![1]; // exactly how the site's builder finds it
    const { default: YAML } = await import("yaml");
    const meta = YAML.parse(front);
    expect(Object.keys(meta).sort()).toEqual(["description", "title", "updated"]);
    expect(meta.title).toBe("Colon: and # hash");
    expect(meta.description).toBe("multi line --- stuff: yes");
  });

  it("keeps unknown front matter keys when editing", async () => {
    await setupDepartments();
    // hand-edited guide with an extra key
    const clone = path.join(w.tmp, "c"); git(undefined, "clone", w.bare, clone);
    fs.writeFileSync(path.join(clone, "content/finance/extra.md"), "---\ntitle: E\ndescription: d\nupdated: 2026-01-01\nauthor: Someone\n---\n\nbody\n");
    git(clone, "add", "-A"); git(clone, "commit", "-m", "x"); git(clone, "push", "origin", "main");
    const r = await updateGuide(w.as("fin").req("PUT", "/api/guides/finance/extra", { title: "E2", description: "d", body: "new", baseHash: "" }), ctx({ category: "finance", slug: "extra" }));
    expect(r.status).toBe(200);
    expect(showRemote(w.bare, "content/finance/extra.md")).toContain("author: Someone");
  });

  it("an upper-case address is lower-cased, never used as typed", async () => {
    await setupDepartments();
    expect((await createGuide(w.as("fin").req("POST", "/api/guides", { ...GUIDE, slug: "Upper" }))).status).toBe(200);
    expect(showRemote(w.bare, "content/finance/upper.md")).toBeTruthy();
  });

  it("an oversize body is refused", async () => {
    await setupDepartments();
    const r = await createGuide(w.as("fin").req("POST", "/api/guides", { ...GUIDE, body: "x".repeat(300_000) }));
    expect(r.status).toBe(400);
  });

  it("garbage JSON is a clean 400", async () => {
    await setupDepartments();
    const req = new Request(`${ORIGIN}/api/guides`, { method: "POST", headers: w.as("fin").headers({ "content-type": "application/json" }), body: "{nope" });
    expect((await createGuide(req)).status).toBe(400);
  });
});

describe("pictures", () => {
  const send = (who: string, name: string, data: Buffer, category = "finance") => {
    const fd = new FormData();
    fd.append("image", new File([new Uint8Array(data)], name, { type: "image/png" }));
    return upload(w.as(who).req("POST", `/api/upload/${category}`, fd), ctx({ category }));
  };
  it("accepts a real PNG and serves it back", async () => {
    await setupDepartments();
    const r = await send("fin", "Screen Shot.png", PNG);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.path).toBe("finance/screen-shot.png");
    expect(j.src).toBe("../images/finance/screen-shot.png");
    expect(showRemote(w.bare, "content/images/finance/screen-shot.png")).not.toBeNull();
    const got = await image(w.as("hr").req("GET", "/img/finance/screen-shot.png"), ctx({ path: ["finance", "screen-shot.png"] }));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
  });
  it.each([
    ["evil.png", Buffer.from("<script>alert(1)</script>")],
    ["evil.svg", Buffer.from("<svg onload=alert(1)></svg>")],
    ["evil.html", Buffer.from("<html></html>")],
    ["empty.png", Buffer.alloc(0)],
  ])("refuses %s", async (name, data) => {
    await setupDepartments();
    expect((await send("fin", name, data)).status).toBe(400);
  });
  it("refuses an oversize picture", async () => {
    await setupDepartments();
    expect((await send("fin", "big.png", Buffer.concat([PNG, Buffer.alloc(6_000_000)]))).status).toBe(400);
  });
  it("won't serve files outside content/images", async () => {
    await setupDepartments();
    for (const p of [["..", "..", "build.py"], ["finance", "..", "..", "build.py"], ["%2e%2e", "build.py"], ["finance", "nope.png"]]) {
      const r = await image(w.as("fin").req("GET", "/img/x"), ctx({ path: p }));
      expect(r.status).toBe(404);
    }
  });
});

describe.skipIf(!pythonHasBuilder())("preview", () => {
  it("renders with the site's builder and strips dangerous HTML", async () => {
    await setupDepartments();
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)><iframe src="//e"></iframe><a href="javascript:alert(3)">x</a><p style="x">ok</p>\n\n::: callout Note\nhello\n:::';
    const r = await preview(w.as("fin").req("POST", "/api/preview", { category: "finance", title: "T", body: evil }));
    expect(r.status).toBe(200);
    const { html } = await r.json();
    expect(html).not.toMatch(/<script>alert|onerror|<iframe|javascript:/);
    expect(html).toContain("hello");
    expect(html).toContain("<h1>T</h1>");
  });
  it("inlines uploaded pictures so a sandboxed preview can show them", async () => {
    await setupDepartments();
    const fd = new FormData(); fd.append("image", new File([new Uint8Array(PNG)], "p.png"));
    await upload(w.as("fin").req("POST", "/api/upload/finance", fd), ctx({ category: "finance" }));
    const r = await preview(w.as("fin").req("POST", "/api/preview", { category: "finance", title: "T", body: "![p](../images/finance/p.png)" }));
    expect((await r.json()).html).toContain("data:image/png;base64,");
  });
});

describe("departments", () => {
  it("a new department adds its category to categories.yaml", async () => {
    const r = await createDepartment(w.as("adm").req("POST", "/api/departments", { name: "Procurement", mode: "new", color: "#123456" }));
    expect(r.status).toBe(200);
    const yaml = showRemote(w.bare, "config/categories.yaml")!;
    expect(yaml).toContain("slug: procurement");
    expect(yaml).toContain('"#123456"');
    expect(yaml).toContain("# categories"); // comments and other entries untouched
  });
  it("rejects duplicates, reserved names and bad colours", async () => {
    await setupDepartments();
    const adm = w.as("adm");
    const post = (b: object) => createDepartment(adm.req("POST", "/api/departments", b)).then((r) => r.status);
    expect(await post({ name: "Finance", mode: "new" })).toBe(400);
    expect(await post({ name: "Images", mode: "new" })).toBe(400);
    expect(await post({ name: "Bad", mode: "new", color: "red;}</style>" })).toBe(400);
    expect(await post({ name: "Another", mode: "existing", existingSlug: "finance" })).toBe(400);
    expect(await post({ name: "Ghost", mode: "existing", existingSlug: "nothing" })).toBe(400);
    expect(await post({ name: "Folder", mode: "new", slug: "../x" })).toBe(400);
  });
  it("membership grants and removes access", async () => {
    const { fid } = await setupDepartments();
    const adm = w.as("adm");
    expect((await createGuide(w.as("nobody").req("POST", "/api/guides", { ...GUIDE, slug: "n1" }))).status).toBe(403);
    expect((await addMembers(adm.req("POST", `/api/departments/${fid}/members`, { usernames: "Outsider, new.person" }), ctx({ id: String(fid) }))).status).toBe(200);
    expect((await createGuide(w.as("nobody").req("POST", "/api/guides", { ...GUIDE, slug: "n2" }))).status).toBe(200);
    expect((await removeMember(adm.req("DELETE", "/x"), ctx({ id: String(fid), username: "outsider" }))).status).toBe(200);
    expect((await createGuide(w.as("nobody").req("POST", "/api/guides", { ...GUIDE, slug: "n3" }))).status).toBe(403);
  });
  it("bad usernames are rejected", async () => {
    const { fid } = await setupDepartments();
    const r = await addMembers(w.as("adm").req("POST", `/api/departments/${fid}/members`, { usernames: "ok ../etc <b>" }), ctx({ id: String(fid) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("look like usernames");
  });
  it("renaming updates the site category too", async () => {
    const { fid } = await setupDepartments();
    const r = await editDepartment(w.as("adm").req("PATCH", `/api/departments/${fid}`, { name: "Finance & Accounts", color: "#112233" }), ctx({ id: String(fid) }));
    expect(r.status).toBe(200);
    const yaml = showRemote(w.bare, "config/categories.yaml")!;
    expect(yaml).toContain('"Finance & Accounts"');
    expect(yaml).toContain("slug: hr"); // the neighbour is untouched
  });
  it("deleting a department removes access but keeps the guides", async () => {
    const { fid } = await setupDepartments();
    expect((await deleteDepartment(w.as("adm").req("DELETE", "/x"), ctx({ id: String(fid) }))).status).toBe(200);
    expect((await createGuide(w.as("fin").req("POST", "/api/guides", GUIDE))).status).toBe(403);
    expect(showRemote(w.bare, "content/finance/invoices.md")).not.toBeNull();
  });
  it("unknown department -> 404", async () => {
    expect((await deleteDepartment(w.as("adm").req("DELETE", "/x"), ctx({ id: "999" }))).status).toBe(404);
    expect((await deleteDepartment(w.as("adm").req("DELETE", "/x"), ctx({ id: "abc" }))).status).toBe(404);
  });
  it("everything admins do is logged", async () => {
    await setupDepartments();
    const actions = w.svc.db.auditRecent().map((a) => a.action);
    expect(actions).toContain("department.create");
    expect(actions).toContain("member.add");
  });
});

describe("GitHub trouble", () => {
  it("a push race (someone edits on GitHub meanwhile) is rebased, not lost", async () => {
    await setupDepartments();
    const other = path.join(w.tmp, "other");
    git(undefined, "clone", w.bare, other);
    fs.writeFileSync(path.join(other, "README.txt"), "hi");
    git(other, "add", "-A"); git(other, "commit", "-m", "outside change"); git(other, "push", "origin", "main");
    expect((await createGuide(w.as("fin").req("POST", "/api/guides", GUIDE))).status).toBe(200);
    expect(showRemote(w.bare, "README.txt")).toBe("hi");
    expect(showRemote(w.bare, "content/finance/month-end.md")).toBeTruthy();
  });
  it("when GitHub can't be reached nothing is half-saved", async () => {
    await setupDepartments();
    await w.svc.repo.read(() => undefined, true);
    execFileSync("git", ["remote", "set-url", "origin", "/nonexistent"], { cwd: w.svc.repo.dir });
    const r = await createGuide(w.as("fin").req("POST", "/api/guides", GUIDE));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("Your text is still here");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: w.svc.repo.dir }).toString();
    expect(status).toBe("");
  });
});
