# FRR-003: Task Management

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want a prioritized action list tied to my search context so that commitments do not get lost across opportunities and relationships.
- **Current State**: The Tasks workspace summarizes overdue, due-today, open, and completed work and supports search and workflow filters.
- **Why Now**: Opportunity and networking context is only useful when it leads to timely, trackable action.

## 🛠️ Functional Specifications

- **Trigger**: The user opens Tasks, changes a filter, opens a task, or creates, updates, or completes one through a supported client.
- **Input Data**: Title, type, priority, status, due date, notes, and an optional relationship to a gig, person, or the search generally.
- **Happy Path**:
  1. The user sees urgent and upcoming work ordered to support daily prioritization.
  2. The user opens a task for its full context and records progress without losing its relationship to the search.
- **Alternative Paths**:
  - A task has no due date -> Keep it available without labeling it overdue.
  - No tasks match -> Show an empty result rather than an empty overall workload claim.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** overdue and due-today tasks, **When** the user opens Tasks, **Then** their urgency and summary counts agree.
  - **Given** a task related to a gig or person, **When** it is displayed, **Then** the related entity is identified with a friendly label.
- **Error Boundaries**: A failed mutation preserves the prior task and reports that the requested change did not complete.
- **Data Validation**: Task status, type, priority, dates, and related-entity references use shared domain rules.

## 🛑 Out of Scope

- Calendar synchronization or reminder delivery.
- General-purpose project management outside the job search.

## 📈 Consequences & Impact

- **UX/UI Impact**: Tasks provide an action-oriented ledger with urgency signals, summaries, filters, and details.
- **Data Model Changes**: None; this requirement describes the existing Task contract.
- **Performance Targets**: Sorting, search, and filters should respond immediately for a personal workload.
