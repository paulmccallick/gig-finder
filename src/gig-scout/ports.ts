export interface HttpRequest { url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number; maxResponseBytes: number; signal?: AbortSignal; }
export interface HttpResponse { status: number; url: string; headers: Record<string, string>; body: string; }
export interface GigScoutHttpPort { request(request: HttpRequest): Promise<HttpResponse>; }
export interface GigScoutClock { now(): Date; }

export class BoundedFetchHttpPort implements GigScoutHttpPort {
  async request(input: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    let timedOut=false;
    const timeout = setTimeout(()=>{timedOut=true;abort();}, input.timeoutMs);
    try {
      const response = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body, redirect: "error", signal: controller.signal });
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > input.maxResponseBytes) throw new Error("response_too_large");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > input.maxResponseBytes) { await reader.cancel(); throw new Error("response_too_large"); }
        chunks.push(chunk.value);
      }
      return { status: response.status, url: response.url, headers: Object.fromEntries(response.headers.entries()), body: new TextDecoder().decode(Buffer.concat(chunks)) };
    } catch(error) {
      if(timedOut)throw new Error("request_timeout",{cause:error});
      throw error;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
  }
}
