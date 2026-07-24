# Agent Context: Memory, RAG, Tools, and Skills

An effective agent receives the right information through several distinct
mechanisms. They complement one another, but they are not interchangeable.

## Always-Present Context

Always-present context is supplied with every model request. It defines the
agent's purpose, behavior, constraints, and essential background.

Use it for information that is:

- Relevant to nearly every interaction.
- Small enough to justify repeated token cost.
- Stable or deliberately controlled.
- Necessary for safety, identity, or consistent decisions.

Keep it concise. Large instructions compete with the user's request and other
useful evidence. Separate behavioral policy from user-provided context, and
never allow retrieved or user-supplied content to override higher-priority
rules.

## Memory

Memory preserves information across interactions.

**Conversation memory** contains messages from the current thread so the agent
can understand follow-up questions. Persist it when conversations must survive
page reloads, devices, or sessions.

**Durable memory** contains selected facts, preferences, decisions, or lessons
that remain useful beyond one conversation. Durable memories should be
structured, attributable, editable, and versioned. Store their source and
creation time, and distinguish confirmed facts from inferences.

Do not automatically convert every message into memory. Use explicit rules or
confirmation for consequential facts. Memory is contextual assistance, not the
authoritative store for operational data.

## Retrieval-Augmented Generation

RAG retrieves relevant material from a larger body of content and adds selected
passages to the model request.

A typical retrieval pipeline:

1. Parse documents into meaningful chunks.
2. Store each chunk with source and metadata.
3. Retrieve candidates using lexical, semantic, or hybrid search.
4. Apply access controls and metadata filters.
5. Rank and limit results.
6. Provide excerpts with source references to the model.

Embeddings enable semantic similarity search, but embeddings are not themselves
RAG. Start with the simplest retrieval method that meets the need. Hybrid
retrieval often works best: structured filters narrow the scope, while lexical
and semantic ranking find relevant passages.

RAG is best for large, mostly textual knowledge. Retrieved content may be stale,
incomplete, or malicious, so preserve provenance and treat it as evidence
rather than instructions.

## Tools

Tools let the model request information or actions from application code. A
tool normally has a clear name, usage description, validated input schema, and
structured result.

Use tools for:

- Current or authoritative structured data.
- Calculations and deterministic operations.
- External systems and APIs.
- Actions that change state.

Tool interfaces should be narrow and task-oriented. Validate inputs, enforce
authorization in application code, make writes idempotent where practical, and
record an audit trail. Require user approval for consequential or irreversible
actions. The model may propose a tool call, but the application remains
responsible for whether and how it executes.

## Skills

Skills package reusable instructions, domain knowledge, workflows, resources,
and references to permitted tools. They teach an agent how to approach a class
of tasks consistently; they do not inherently give it new authority.

Keep compact skill metadata available for discovery, then load full
instructions and resources only when the skill is relevant. This progressive
disclosure reduces token use and prevents unrelated guidance from competing for
the model's attention.

Skills should be portable, versioned, testable, and explicit about
dependencies. Keep executable tools separately registered and authorized by the
host application. Validate resource paths, enforce context budgets, preserve
instruction priority, and log skill activation. A skill may direct the agent to
use memory, retrieval, or tools, but it does not replace any of them.

## How They Work Together

For each request, the runtime assembles a bounded working context:

```text
instructions + selected skills + memory + retrieved evidence + tool definitions
                                    ↓
                                  model
                                    ↓
                        response or validated tool call
```

Tool results can lead to additional model steps. Conversation messages preserve
the resulting exchange. Selected information may later become durable memory,
while authoritative changes remain in their source system.

The governing principle is simple: keep universal guidance always present,
package reusable task guidance as skills, store continuity as memory, retrieve
large textual knowledge through RAG, and access live state or perform actions
through tools.
