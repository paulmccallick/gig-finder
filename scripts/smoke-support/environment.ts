const inheritedEnvironmentKeys = [
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
] as const;

export function smokeEnvironment(
  source: Record<string, string | undefined>,
  overrides: Record<string, string> = {},
) {
  const environment: Record<string, string> = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = source[key];
    if (value) environment[key] = value;
  }
  return { ...environment, ...overrides };
}
