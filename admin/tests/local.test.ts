import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createGuide } from "@/app/api/guides/route";
import { DELETE as deleteGuide, PUT as updateGuide } from "@/app/api/guides/[category]/[slug]/route";
import { POST as upload } from "@/app/api/upload/[category]/route";
import { POST as createDepartment } from "@/app/api/departments/route";
import { POST as addMembers } from "@/app/api/departments/[id]/members/route";
import { makeWorld, ctx, type World } from "./harness";

let w: World;
beforeEach(async () => { w = await makeWorld(true); });
afterEach(() => w.cleanup());

const site = (...p: string[]) => path.join(w.svc.repo.dir, ...p);
const history = () => fs.existsSync(path.join(w.tmp, "data", "history"))
  ? fs.readdirSync(path.join(w.tmp, "data", "history")).sort() : [];
const GUIDE = { category: "finance", title: "Month end", description: "Close the books", slug: "month-end", body: "## Steps\n\nDo it.\n" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

async function setup() {
  const adm = w.as("adm");
  expect((await createDepartment(adm.req("POST", "/api/departments", { name: "Finance", mode: "existing", existingSlug: "finance" }))).status).toBe(200);
  const id = w.svc.db.departmentBySlug("finance")!.id;
  expect((await addMembers(adm.req("POST", `/api/departments/${id}/members`, { usernames: "fatima" }), ctx({ id: String(id) }))).status).toBe(200);
}

describe("local files mode (no GitHub)", () => {
  it("saves straight into the site folder and keeps the old versions", async () => {
    await setup();
    const fin = w.as("fin");
    expect((await createGuide(fin.req("POST", "/api/guides", GUIDE))).status).toBe(200);
    expect(fs.readFileSync(site("content/finance/month-end.md"), "utf8")).toContain("title: Month end");
    expect(fs.existsSync(site(".git"))).toBe(false);

    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(fs.readFileSync(site("content/finance/month-end.md"))).digest("hex");
    expect((await updateGuide(fin.req("PUT", "/api/guides/finance/month-end",
      { title: "Month end", description: "d", body: "changed", baseHash: hash }), ctx({ category: "finance", slug: "month-end" }))).status).toBe(200);
    const [created, edited] = history();
    expect(fs.readFileSync(path.join(w.tmp, "data/history", created, "changes.txt"), "utf8")).toContain("A content/finance/month-end.md");
    const oldCopy = path.join(w.tmp, "data/history", edited, "before/content/finance/month-end.md");
    expect(fs.readFileSync(oldCopy, "utf8")).toContain("Do it.");
    expect(fs.readFileSync(path.join(w.tmp, "data/history", edited, "changes.txt"), "utf8")).toContain("by Fatima Finance");

    expect((await deleteGuide(fin.req("DELETE", "/api/guides/finance/month-end"), ctx({ category: "finance", slug: "month-end" }))).status).toBe(200);
    expect(fs.existsSync(site("content/finance/month-end.md"))).toBe(false);
    const last = history().at(-1)!;
    expect(fs.readFileSync(path.join(w.tmp, "data/history", last, "before/content/finance/month-end.md"), "utf8")).toContain("changed");
  });

  it("a failed change leaves every file exactly as it was", async () => {
    await setup();
    const before = fs.readFileSync(site("config/categories.yaml"), "utf8");
    await expect(w.svc.repo.publish("x", { name: "t", email: "t@t" }, (root) => {
      fs.writeFileSync(path.join(root, "content/finance/new.md"), "new");
      fs.writeFileSync(path.join(root, "content/finance/invoices.md"), "ruined");
      fs.writeFileSync(path.join(root, "config/categories.yaml"), "broken");
      fs.unlinkSync(path.join(root, "content/hr/.gitkeep"), );
    })).rejects.toThrow();
    expect(fs.existsSync(site("content/finance/new.md"))).toBe(false);
    expect(fs.readFileSync(site("content/finance/invoices.md"), "utf8")).toContain("Hello.");
    expect(fs.readFileSync(site("config/categories.yaml"), "utf8")).toBe(before);
    expect(history().length).toBe(0);
  });

  it("pictures are saved and the site's other files are untouched", async () => {
    await setup();
    const buildBefore = fs.readFileSync(site("build.py"));
    const form = new FormData();
    form.set("image", new File([new Uint8Array(PNG)], "pic.png", { type: "image/png" }));
    const r = await upload(w.as("fin").req("POST", "/api/upload/finance", form), ctx({ category: "finance" }));
    expect(r.status).toBe(200);
    expect(fs.readdirSync(site("content/images/finance")).length).toBe(1);
    expect(fs.readFileSync(site("build.py")).equals(buildBefore)).toBe(true);
  });

  it("old history is pruned", async () => {
    const { LocalStore } = await import("@/lib/localstore");
    const store = new LocalStore({ dir: w.svc.repo.dir, historyDir: path.join(w.tmp, "h"), keepHistory: 3 });
    for (let i = 0; i < 6; i++) {
      await store.publish(`n${i}`, { name: "t", email: "t@t" }, (root) => fs.writeFileSync(path.join(root, "content/finance/a.md"), String(i)));
      await new Promise((res) => setTimeout(res, 5));
    }
    expect(fs.readdirSync(path.join(w.tmp, "h")).length).toBe(3);
  });
});
