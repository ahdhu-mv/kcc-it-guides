/** Department and membership rules (shared by the API routes). */
import { USERNAME_RE } from "./auth";
import type { Db, Department } from "./db";
import { HttpError, ValidationError } from "./errors";
import * as guides from "./guides";

export function parseUsernames(raw: string): string[] {
  const names: string[] = [];
  const bad: string[] = [];
  for (const token of (raw ?? "").trim().toLowerCase().split(/[\s,;]+/)) {
    if (!token) continue;
    (USERNAME_RE.test(token) ? names : bad).push(token);
  }
  if (bad.length) {
    throw new ValidationError(
      `These don't look like usernames: ${bad.slice(0, 5).join(", ")}. ` +
      "Use the AD sign-in name (letters, numbers, dot, dash or underscore).");
  }
  return [...new Set(names)];
}

export function departmentOr404(db: Db, id: number): Department {
  const d = Number.isInteger(id) ? db.department(id) : undefined;
  if (!d) throw new HttpError(404, "Department not found", "That department doesn't exist.");
  return d;
}

export type NewDepartment =
  | { mode: "new"; name: string; color: string; slug: string }
  | { mode: "existing"; name: string; slug: string };

/** Validate a new-department request against current state (no writes). */
export function planDepartment(
  db: Db, root: string,
  input: { name: unknown; mode: unknown; slug: unknown; existingSlug: unknown; color: unknown },
): NewDepartment {
  const name = guides.checkDisplayName(input.name as string);
  const existing = db.departments();
  if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError("A department with that name already exists.");
  }
  const taken = new Set(existing.map((d) => d.slug));
  const cats = new Set(guides.loadCategories(root).map((c) => c.slug));
  if (input.mode === "existing") {
    const slug = String(input.existingSlug ?? "");
    if (!cats.has(slug)) throw new ValidationError("Choose one of the existing categories.");
    if (taken.has(slug)) throw new ValidationError("That category already belongs to a department.");
    return { mode: "existing", name, slug };
  }
  const color = guides.checkColor((input.color as string) || "#0f6b62");
  const slug = (String(input.slug ?? "").trim() || guides.slugify(name)).toLowerCase();
  guides.checkSlug(slug, "category folder name");
  if (taken.has(slug) || cats.has(slug)) {
    throw new ValidationError("A category with that folder name already exists.");
  }
  return { mode: "new", name, color, slug };
}
