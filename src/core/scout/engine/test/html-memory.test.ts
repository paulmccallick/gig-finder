import { expect, test } from "bun:test";

for (const mode of ["listing", "dom", "json-ld", "ambiguous"]) {
  test(`Scout ${mode} extraction releases HTML and end-tag callbacks`, async () => {
    const child = Bun.spawn(
      [process.execPath, new URL("./fixtures/html-memory-probe.ts", import.meta.url).pathname, mode],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout);
    // Native allocator RSS is not a stable leak measurement. Check live external
    // storage and GC-protected callbacks in a fresh process after warmup instead.
    expect(result.externalGrowth).toBeLessThan(8 * 1024 * 1024);
    expect(result.protectedFunctionGrowth).toBeLessThanOrEqual(0);
  }, 30_000);
}

