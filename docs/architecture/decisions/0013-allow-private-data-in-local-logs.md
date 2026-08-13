# ADR 0013: Allow private application data in local logs

**Status:** Accepted
**Date:** 2026-08-13

## Context

GigFinder runs for one user on one private machine. Troubleshooting Scout and
other workflows requires seeing the profile, companies, URLs, filters, source
responses, and descriptions involved. Obfuscating this data reduces diagnostic
value without creating a meaningful boundary from the machine's owner.

## Decision

Private runtime logs may contain profile and company information, including
names, URLs, filters, bounded response bodies, and descriptions. The application
does not obfuscate this information merely because it is private application
data.

Logs remain private local state and must not enter source control, tests,
container images, or release artifacts. Credentials, authentication headers,
cookies, session tokens, and API secrets are never logged. Large values are
bounded and marked when truncated to protect local storage.

## Consequences

Logs provide enough context to diagnose sourcing, parsing, pagination, and
workflow failures directly. Anyone with access to the machine or its backups may
also read private application data from its logs, so operating-system access,
file permissions, retention, and backup handling provide the security boundary.
