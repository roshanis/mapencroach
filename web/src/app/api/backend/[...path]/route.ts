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
  // Forwarded so conditional requests survive the hop: retained scene images
  // are content-addressed and served with a strong ETag, so a re-fetch should
  // be able to come back 304 instead of re-sending the bytes.
  for (const name of ["if-none-match", "if-modified-since", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

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

  // Read as bytes, never as text. Retained scene images come back through
  // this proxy, and `Response.text()` decodes as UTF-8: every byte sequence
  // that is not valid UTF-8 becomes U+FFFD, so a JPEG or PNG would arrive
  // silently corrupted -- a 200 carrying garbage, which is worse than an
  // error, because nothing downstream can tell it apart from a real image.
  const responseBody = await upstreamResponse.arrayBuffer();

  const responseHeaders = new Headers();
  // ETag and Cache-Control are what make content-addressed scene bytes
  // cacheable and revalidatable; dropping them here would silently turn every
  // thumbnail into a full re-download.
  for (const name of [
    "content-type",
    "etag",
    "cache-control",
    "content-disposition",
    "last-modified",
  ]) {
    const value = upstreamResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  // 204 and 304 are defined to carry no body; handing one a buffer makes the
  // runtime throw rather than pass the status through.
  const bodyless =
    upstreamResponse.status === 204 || upstreamResponse.status === 304;

  return new NextResponse(bodyless ? null : responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
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
