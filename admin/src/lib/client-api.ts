"use client";

/** JSON request helper for the browser. Adds the CSRF token the page was served with. */
export type ApiResult<T = Record<string, unknown>> =
  { ok: true; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

export async function callApi<T = Record<string, unknown>>(
  method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown | FormData,
): Promise<ApiResult<T>> {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? "";
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        "X-CSRF-Token": csrf, Accept: "application/json",
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try { data = await resp.json(); } catch { /* not JSON */ }
    if (resp.ok) return { ok: true, data: data as T };
    if (resp.status === 401) {
      return { ok: false, status: 401, data, error: "Your sign-in expired. Reload the page, sign in again, and your text will need to be copied first." };
    }
    return { ok: false, status: resp.status, data, error: String(data.error ?? "Something went wrong.") };
  } catch {
    return { ok: false, status: 0, data: {}, error: "Could not reach the server. Check your connection and try again." };
  }
}
