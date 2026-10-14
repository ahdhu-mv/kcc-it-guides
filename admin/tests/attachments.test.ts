import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createGuide } from "@/app/api/guides/route";
import { POST as attach } from "@/app/api/attachments/[category]/route";
import { DELETE as deleteStored } from "@/app/api/stored/[kind]/[category]/[name]/route";
import { GET as download } from "@/app/dl/[...path]/route";
import { POST as createDepartment } from "@/app/api/departments/route";
import { POST as addMembers } from "@/app/api/departments/[id]/members/route";
import { listStored, zipNames } from "@/lib/attachments";
import { makeWorld, ctx, type World } from "./harness";

let w: World;
beforeEach(async () => { w = await makeWorld(true); });
afterEach(() => w.cleanup());
const site = (...p: string[]) => path.join(w.svc.repo.dir, ...p);

/** A minimal zip (stored, no compression) with the given entry names. */
function zip(names: string[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const n of names) {
    const nb = Buffer.from(n);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb); central.push(ch, nb); off += 30 + nb.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const DOCX = zip(["[Content_Types].xml", "word/document.xml"]);
const upload = (who: ReturnType<World["as"]>, name: string, data: Buffer, category = "finance") => {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(data)], name));
  return attach(who.req("POST", `/api/attachments/${category}`, fd), ctx({ category }));
};

async function setup() {
  const adm = w.as("adm");
  await createDepartment(adm.req("POST", "/api/departments", { name: "Finance", mode: "existing", existingSlug: "finance" }));
  const id = w.svc.db.departmentBySlug("finance")!.id;
  await addMembers(adm.req("POST", `/api/departments/${id}/members`, { usernames: "fatima" }), ctx({ id: String(id) }));
}

describe("file attachments", () => {
  it("reads zip entry names", () => {
    expect(zipNames(DOCX)).toEqual(["[Content_Types].xml", "word/document.xml"]);
  });

  it("accepts real files of each type and returns a link", async () => {
    await setup();
    const fin = w.as("fin");
    const r = await upload(fin, "Expense Form.docx", DOCX);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.href).toBe("../files/finance/expense-form.docx");
    expect(body.markdown).toBe("[Expense Form (Word, " + `${DOCX.length} B` + ")](../files/finance/expense-form.docx)");
    expect(fs.existsSync(site("content/files/finance/expense-form.docx"))).toBe(true);
    expect((await upload(fin, "Expense Form.docx", DOCX)).status).toBe(200);
    expect(fs.existsSync(site("content/files/finance/expense-form-2.docx"))).toBe(true);
    expect((await upload(fin, "a.pdf", Buffer.from("%PDF-1.7\n..."))).status).toBe(200);
    expect((await upload(fin, "a.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).status).toBe(200);
    expect((await upload(fin, "data.csv", Buffer.from("name,amount\r\nAli,10\r\n"))).status).toBe(200);
    expect((await upload(fin, "ansi.csv", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))).status).toBe(200);
  });

  it("refuses wrong types, fake files, macros, binary text, empty and oversized files", async () => {
    await setup();
    const fin = w.as("fin");
    for (const [name, data] of [
      ["x.exe", Buffer.from("MZ....")], ["x.zip", zip(["a"])], ["x.html", Buffer.from("<script>")],
      ["x.docm", zip(["[Content_Types].xml", "word/document.xml"])],
      ["fake.pdf", Buffer.from("hello")], ["fake.docx", Buffer.from("hello")],
      ["wrong.xlsx", DOCX], ["macro.docx", zip(["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"])],
      ["bin.txt", Buffer.from([65, 0, 66])], ["empty.txt", Buffer.alloc(0)],
    ] as [string, Buffer][]) {
      expect((await upload(fin, name, data)).status, name).toBe(400);
    }
    const big = Buffer.alloc(w.svc.cfg.maxFileBytes + 1, 0x41);
    expect((await upload(fin, "big.txt", big)).status).toBe(400);
    expect(fs.existsSync(site("content/files"))).toBe(false);
  });

  it("only lets people attach to their own category", async () => {
    await setup();
    expect((await upload(w.as("fin"), "a.txt", Buffer.from("hi"), "hr")).status).toBeGreaterThanOrEqual(403);
  });

  it("finds unused files, refuses to delete used ones, keeps a copy of deleted ones", async () => {
    await setup();
    const fin = w.as("fin");
    await upload(fin, "used.txt", Buffer.from("used"));
    await upload(fin, "spare.txt", Buffer.from("spare"));
    // a big one, to exercise the no-memory path
    const big = Buffer.alloc(1_500_000, 0x61);
    await upload(fin, "big.txt", big);
    await createGuide(fin.req("POST", "/api/guides", {
      category: "finance", title: "Forms", description: "", slug: "forms", body: "Get the [form](../files/finance/used.txt).\n" }));

    const items = listStored(w.svc.repo.dir);
    const by = Object.fromEntries(items.map((i) => [i.rel, i.usedBy]));
    expect(by["finance/used.txt"]).toEqual(["finance/forms"]);
    expect(by["finance/spare.txt"]).toEqual([]);

    const adm = w.as("adm");
    const del = (name: string, who = adm) => deleteStored(who.req("DELETE", `/api/stored/files/finance/${name}`),
      ctx({ kind: "files", category: "finance", name }));
    expect((await del("used.txt")).status).toBe(400);
    expect(fs.existsSync(site("content/files/finance/used.txt"))).toBe(true);
    expect((await del("spare.txt", fin)).status).toBeGreaterThanOrEqual(403); // not an admin
    expect((await del("spare.txt")).status).toBe(200);
    expect((await del("big.txt")).status).toBe(200);
    expect(fs.existsSync(site("content/files/finance/spare.txt"))).toBe(false);
    expect(fs.existsSync(site("content/.keep"))).toBe(false);

    const hist = path.join(w.tmp, "data", "history");
    const last = fs.readdirSync(hist).sort().at(-1)!;
    expect(fs.readFileSync(path.join(hist, last, "before/content/files/finance/big.txt")).equals(big)).toBe(true);
    expect(fs.readFileSync(path.join(hist, last, "changes.txt"), "utf8")).toContain("D content/files/finance/big.txt");
  });

  it("downloads an attachment with safe headers", async () => {
    await setup();
    await upload(w.as("fin"), "a.csv", Buffer.from("a,b\n"));
    const r = await download(w.as("fin").req("GET", "/dl/finance/a.csv"), ctx({ path: ["finance", "a.csv"] }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("attachment");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await download(w.as("fin").req("GET", "/dl/finance/../x"), ctx({ path: ["finance", "..", "x"] }))).status).toBe(404);
  });

  it("puts big files back when a change fails", async () => {
    await setup();
    const big = Buffer.alloc(1_500_000, 0x62);
    await upload(w.as("fin"), "keep.txt", big);
    await expect(w.svc.repo.publish("x", { name: "t", email: "t@x" }, (root) => {
      fs.rmSync(path.join(root, "content/files/finance/keep.txt"));
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(fs.readFileSync(site("content/files/finance/keep.txt")).equals(big)).toBe(true);
  });
});
