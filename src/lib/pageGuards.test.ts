import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page in the staff app (src/app/(app)) checks who is opening it before
 * it does anything else, with a page guard from src/lib/authz.ts that matches
 * who the page is for. The middleware is the first layer; this is the
 * backstop that holds even if the middleware doesn't run (as it didn't until
 * Nov 2026) and on moves between pages, when the layout doesn't re-run.
 *
 * A new page without a guard, or with the wrong one, fails here.
 */

const APP_DIR = join(process.cwd(), "src", "app", "(app)");

type Kind = "admin" | "staff" | "officer";

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pageFiles(p, out);
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

/** The page's URL: route groups like (app) dropped, [id] kept. */
function urlFor(file: string): string {
  const parts = relative(APP_DIR, file).split(sep).slice(0, -1);
  return "/" + parts.filter((s) => !/^\(.*\)$/.test(s)).join("/");
}

/** Who a page is for, following middleware.ts. A staff page may be stricter
 *  (admin only) when only admins can use it. */
function allowedKinds(url: string): Kind[] {
  if (url === "/m" || url.startsWith("/m/")) return ["officer"];
  if (url === "/admin/reports" || url.startsWith("/admin/reports/")) return ["staff"];
  if (url === "/admin" || url.startsWith("/admin/")) return ["admin"];
  if (url === "/finance" || url.startsWith("/finance/")) return ["admin"];
  return ["staff", "admin"];
}

/** The first statement of the page's default export, and whether it's async. */
function firstStatement(src: string): { async: boolean; line: string } | null {
  const m = /export default (async )?function \w*\s*\(/.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1; // inside the parameter list's "("
  while (depth > 0 && i < src.length) {
    const c = src[i++];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
  }
  const open = src.indexOf("{", i);
  const rest = src.slice(open + 1).replace(/^(\s*\/\/[^\n]*\n|\s*\n)*/, "");
  return { async: Boolean(m[1]), line: rest.split("\n")[0].trim() };
}

const pages = pageFiles(APP_DIR).sort();

describe("staff-app page guards", () => {
  it("finds the staff-app pages", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  for (const file of pages) {
    const url = urlFor(file);
    it(`${url} checks its visitor first, with the right guard`, () => {
      const src = readFileSync(file, "utf8");
      const first = firstStatement(src);
      expect(first, "no default export function").not.toBeNull();
      expect(first!.async, "the page must be async to await its guard").toBe(true);
      const g = /^(?:const [^=]+= )?await require(Admin|Staff|Officer)Page\(\);$/.exec(first!.line);
      expect(g, `first statement is "${first!.line}", not a page guard`).not.toBeNull();
      expect(allowedKinds(url)).toContain(g![1].toLowerCase() as Kind);
      // Pages redirect; the throwing guards are for server actions.
      expect(/\brequire(Admin|Staff)\(\)/.test(src)).toBe(false);
    });
  }
});
