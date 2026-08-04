// Server-side proxy for the FastAPI backend.
//
// Deployments point the client-side NEXT_PUBLIC_API_URL at this route
// (typically the relative path "/api/backend") instead of the backend
// origin directly. That keeps both the backend origin and the service
// bearer token out of the public JS bundle: this route resolves them from
// server-only env vars (MAPENCROACH_BACKEND_URL, MAPENCROACH_API_TOKEN) at
// request time and forwards the request upstream.
//
// Auth precedence for the outgoing Authorization header:
//   1. an Authorization header the browser already sent (persona-scoped
//      client fetches that pass a tokenOverride still work unchanged)
//   2. the mapencroach_token cookie on the incoming request
//   3. the server-only MAPENCROACH_API_TOKEN service token
//   4. no header at all
//
// Tokens are never logged and never echoed back in a response body — this
// route only ever forwards the upstream response verbatim.

import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE } from "@/lib/api";

function resolveBackendBase(): string | undefined {
  const base = process.env.MAPENCROACH_BACKEND_URL;
  return base && base.length > 0 ? base.replace(/\/$/, "") : undefined;
}

function resolveAuthHeader(request: NextRequest): string | undefined {
  const incoming = request.headers.get("authorization");
  if (incoming) return incoming;

  const cookieToken = request.cookies.get(TOKEN_COOKIE)?.value;
  if (cookieToken) return `Bearer ${cookieToken}`;

  const envToken = process.env.MAPENCROACH_API_TOKEN;
  if (envToken) return `Bearer ${envToken}`;

  return undefined;
}

const METHODS_WITH_BODY = new Set(["POST", "PATCH", "DELETE"]);

async function proxy(
  request: NextRequest,
  path: string[]
): Promise<NextResponse> {
  const base = resolveBackendBase();
  if (!base) {
    return NextResponse.json(
      { detail: "backend not configured" },
      { status: 503 }
    );
  }

  const upstreamUrl = `${base}/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  const authHeader = resolveAuthHeader(request);
  if (authHeader) headers.set("authorization", authHeader);

  let body: string | undefined;
  if (METHODS_WITH_BODY.has(request.method)) {
    const text = await request.text();
    if (text.length > 0) {
      body = text;
      const contentType = request.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
    });
  } catch {
    return NextResponse.json(
      { detail: "backend unreachable" },
      { status: 502 }
    );
  }

  const responseBody = await upstreamResponse.text();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  return new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: upstreamContentType
      ? { "content-type": upstreamContentType }
      : undefined,
  });
}

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxy(request, path);
}
