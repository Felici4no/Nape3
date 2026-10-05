import { NextResponse, type NextRequest } from "next/server";

const DOCS_HOST = "docs.upay3food.com";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0]?.toLowerCase();
  if (host !== DOCS_HOST) return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/docs") || pathname.startsWith("/api") || pathname.startsWith("/_next")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? "/docs" : `/docs${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };