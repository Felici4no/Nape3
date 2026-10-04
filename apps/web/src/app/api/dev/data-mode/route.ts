import { DATA_COOKIE, demoSwitchAllowed } from "@/lib/source";

export const dynamic = "force-dynamic";

/**
 * Development switch between the live market and the synthetic demo.
 * Disabled in production unless ALLOW_DEMO_TOGGLE=1. `mode=auto` clears it.
 */
export async function GET(request: Request) {
  if (!demoSwitchAllowed(process.env)) return Response.json({ ok: false, error: "demo switch disabled" }, { status: 403 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  if (mode !== "live" && mode !== "demo" && mode !== "auto") {
    return Response.json({ ok: false, error: "mode must be live, demo or auto" }, { status: 400 });
  }
  // Back to the page the switch was used on, same origin only.
  let back = "/";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const ref = new URL(referer);
      // request.url may carry the server's bind address; compare with the Host the browser used.
      if (ref.host === (request.headers.get("host") ?? url.host)) back = ref.pathname + ref.search;
    } catch {
      /* ignore malformed referer */
    }
  }
  const cookie =
    mode === "auto"
      ? `${DATA_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${DATA_COOKIE}=${mode}; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax; HttpOnly`;
  return new Response(null, { status: 303, headers: { location: back, "set-cookie": cookie } });
}
