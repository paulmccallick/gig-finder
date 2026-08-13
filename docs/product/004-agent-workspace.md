# FRR-004: Agent Workspace

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want an assistant that understands my current search workspace so that I can review context and make supported changes conversationally.
- **Current State**: A resizable agent panel uses the configured candidate profile, durable conversations, managed-document references, and strict tools over core application capabilities.
- **Why Now**: Conversational help is valuable only when it is grounded in current records, transparent while working, and bounded from unsafe actions.

## 🛠️ Functional Specifications

- **Trigger**: The user opens the agent workspace, selects a model or conversation, attaches a supported source, and submits a message.
- **Input Data**: User messages, selected model, candidate-profile context, current application records, referenced documents, and staged DOCX, Markdown, or PDF uploads.
- **Happy Path**:
  1. The assistant shows concise provider-emitted activity while using friendly names to read context or perform supported actions.
  2. The answer and completed activity persist in the active conversation, and supported mutations refresh the dashboard.
- **Alternative Paths**:
  - The user changes layout -> Preserve the mounted session and active response.
  - The user changes model during a response -> Apply the saved choice to the next request.
  - A tool or model call fails -> Explain the failure without exposing internal payloads or identifiers.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** a prior conversation, **When** the user reopens it, **Then** its messages, completed reasoning activity, and document actions are restored.
  - **Given** a supported mutation request, **When** the assistant acts, **Then** core validation, auditing, idempotency, and safe-revert rules apply.
  - **Given** unsupported authority, **When** the assistant is asked to use it, **Then** it does not perform the action.
- **Error Boundaries**: Failure in one turn does not reset the conversation, mounted workspace, or previously committed application state.
- **Data Validation**: Tool inputs are strict adapters over shared domain contracts; unknown fields and invalid transitions are rejected before persistence.

## 🛑 Out of Scope

- Arbitrary filesystem, email, calendar, or external-service access.
- Agent deletion of gigs, people, tasks, relationships, or managed documents.

## 📈 Consequences & Impact

- **UX/UI Impact**: The assistant remains available beside or across the dashboard with durable conversation and accessible activity feedback.
- **Data Model Changes**: None; conversations reference authoritative records and documents without duplicating private document content in message history.
- **Performance Targets**: User-visible activity begins promptly, while long operations remain clearly in progress and do not freeze navigation or layout controls.
