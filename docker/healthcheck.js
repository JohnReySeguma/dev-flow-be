// Docker HEALTHCHECK: exits 0 when the liveness endpoint answers. Node has no curl/wget dependency.
const port = process.env.PORT ?? "4000";

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/v2/health`, { signal: AbortSignal.timeout(4000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
