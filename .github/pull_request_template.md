## Summary

<!-- What changed, why, and the user/developer impact. -->

## Validation

<!-- List the normal checks run for this change. -->

## Smoke evidence

Developer:

- Exact HEAD: `________________________________________`
- `bun run smoke:deterministic`: <!-- passed/failed, duration, bounded notes -->
- `bun run smoke:live`: <!-- passed/failed, duration/cost boundary, bounded notes -->

Independent reviewer:

- Exact reviewed HEAD: `________________________________________`
- `bun run smoke:deterministic`: <!-- passed/failed, duration, bounded notes -->
- `bun run smoke:live`: <!-- passed/failed, duration/cost boundary, bounded notes -->

Any commit after a recorded run invalidates that run. Fixes require both smoke
commands and independent review to run again against the new exact HEAD.
