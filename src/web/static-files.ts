import path from "node:path";

export type StaticFileHandler = (request: Request) => Promise<Response | null>;

const cacheControl = (pathname: string) => pathname.startsWith("/assets/")
  ? "public, max-age=31536000, immutable"
  : "no-cache";

export function createStaticFileHandler(root: string): StaticFileHandler {
  const resolvedRoot = path.resolve(root);

  return async (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    if (pathname.startsWith("/api/") || pathname === "/healthz") return null;

    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const candidate = path.resolve(resolvedRoot, relativePath);
    const relative = path.relative(resolvedRoot, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      return new Response("Not found", { status: 404 });
    }

    let file = Bun.file(candidate);
    if (!(await file.exists())) {
      if (path.extname(relativePath)) return null;
      file = Bun.file(path.join(resolvedRoot, "index.html"));
      if (!(await file.exists())) return null;
    }
    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": cacheControl(pathname),
      },
    });
  };
}
