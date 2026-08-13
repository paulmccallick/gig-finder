# ADR 0012: Use templates for reusable JSON sources

**Status:** Accepted
**Date:** 2026-08-12

## Context

Many companies use the same career-site software such as Workday. All sites can
be sourced either through html scraping or calling a json api. Multiple companies
use the same hr system for career sites. having a config file for each would create
an explosion of configuration. in addition some career sites have specialized requirements
that must be expressed through code.

## Decision

Extend the configuration paradigm to support multiple companies sharing the same base configuration.
Represent reusable sources as configuration templates that are themselves stored as a configuration. A company
can reference a template configuration and may apply
overrides.

To support complex implementations, templates can reference hooks which are defined in code. Hooks can be neded
for complex tasks such as such as acquiring a session cookie or token. Hooks may prepare a
request but may not decode or normalize responses. Hooks are reusable capabilities,
not company-specific implementations.

Templates may only be used to represent hr systems.

## Consequences

Companies sharing a career platform reuse one tested template.
Most companies can be added through configuration alone. This allows for a future capability of
letting agents add companies without editing the code base.
Every template
change must be tested across all companies that use it.
