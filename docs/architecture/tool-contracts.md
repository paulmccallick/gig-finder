# Agent tool contracts

JobSearchAgent has seven read-only tools.

| Tool | Contract |
| --- | --- |
| `list_jobs` | Lists job summaries; filters by stage, outcome, fit, overdue state, and text. |
| `get_job` | Returns one complete job and its registered document references. |
| `list_networking_contacts` | Lists contact summaries; filters by status, priority, relationship strength, overdue state, and text. |
| `get_networking_contact` | Returns one complete contact and its registered profile reference. |
| `list_tasks` | Lists tasks; filters by status, priority, type, related entity, overdue state, and text. |
| `get_task` | Returns one complete task. |
| `get_document` | Resolves an exact reference returned by a detail tool. |

## List behavior

Enum-list filters use OR within a field and AND across fields. Scalar filters
cover text, overdue state, and task relationships. Enum values come from the
domain constants in `src/core` for enum-list filters. Results use deterministic
urgency ordering.

With no filters, jobs default to `applied`, `recruiter_contact`, `screening`,
and `technical_interview`; contacts to `active_relationship`; and tasks to
`open` or `in_progress`. Supplying a meaningful non-default filter broadens an
unprovided job `stages`, contact `statuses`, or task `statuses` field to all
accepted values. `overdueOnly: false` and an empty query do not broaden it.

Text search is case-insensitive. Jobs search company, title, status summary,
and next action; contacts search name, company, title, and why-interesting;
tasks search title, related-entity label, and notes.

Pagination defaults to `offset: 0` and `limit: 20`; the maximum limit is 50.
Responses include totals and the next offset.

## Model-facing schema

Tools use strict JSON schemas. List properties are required and nullable so the
model can leave individual filters unused. Each property carries its own
description; enum-valued properties use domain-derived values.

Detail tools return `not_found` for unknown IDs. Tool exceptions return
`{"status":"error","error":"tool_failed"}`. Documents are limited to 50,000
characters and report whether content was truncated.
