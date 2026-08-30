import { NextResponse, type NextRequest } from "next/server";

/**
 * Attach the request path so unauthenticated redirects can return the user
 * to the intended page (e.g. Cashfree return → /dashboard/pricing?payment=return).
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const pathWithQuery = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  requestHeaders.set("x-pathname", pathWithQuery);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
  ],
};
