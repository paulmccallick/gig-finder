# FRR-002: Relationship Management

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want people, opportunity relationships, and contact history in one workspace so that I can nurture my network with context.
- **Current State**: The dashboard groups people by relationship workflow; person details include identity, notes, links, related gigs, and latest-contact information derived from interactions.
- **Why Now**: A job search depends on relationships that span individual opportunities and persist after a gig closes.

## 🛠️ Functional Specifications

- **Trigger**: The user opens Networking, searches or filters people, opens a person, or records a relationship or interaction through a supported client.
- **Input Data**: Person identity and contact fields, relationship state, priority, notes, tags, gig links, and immutable-history interaction facts.
- **Happy Path**:
  1. The user finds a person in a workflow-oriented view and opens their complete relationship context.
  2. New interactions enrich contact history and latest-contact summaries without overwriting person-owned state.
- **Alternative Paths**:
  - A person relates to several gigs -> Preserve one person record with multiple typed gig relationships.
  - Contact information is missing -> Show the known relationship context without inventing contact details.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** a person linked to multiple gigs, **When** their details are read, **Then** every current relationship is visible from the same person identity.
  - **Given** an interaction is recorded, **When** the person is read, **Then** latest-contact details reflect history while the interaction remains a distinct fact.
- **Error Boundaries**: Failed relationship or interaction changes do not leave one-sided links or partial history.
- **Data Validation**: Relationships reference known gigs and people; interactions reference known participants and retain provenance and supersession semantics.

## 🛑 Out of Scope

- Sending messages, email, or social-network requests.
- Treating workflow status as a substitute for interaction history.

## 📈 Consequences & Impact

- **UX/UI Impact**: Networking emphasizes relationship momentum, priority, context, and recent contact rather than a generic address book.
- **Data Model Changes**: None; this requirement uses Person, gig-person relationship, and Interaction records.
- **Performance Targets**: Personal-network search, filtering, and detail opening should feel immediate.
