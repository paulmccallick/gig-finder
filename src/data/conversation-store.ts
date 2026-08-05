import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  Conversation,
  ConversationMessage,
  ConversationRepository,
} from "../core/conversation-service";

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  last_active_at: string;
}

const fromRow = (row: ConversationRow): Conversation => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  lastActiveAt: row.last_active_at,
});

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly database: Database) {}

  listRecent(limit: number) {
    return (this.database.query(`
      SELECT id, title, created_at, last_active_at
      FROM conversations
      WHERE is_deleted = 0
      ORDER BY last_active_at DESC, id
      LIMIT ?
    `).all(limit) as ConversationRow[]).map(fromRow);
  }

  get(id: string) {
    const row = this.database.query(`
      SELECT id, title, created_at, last_active_at
      FROM conversations
      WHERE id = ? AND is_deleted = 0
    `).get(id) as ConversationRow | null;
    return row ? fromRow(row) : null;
  }

  messages(id: string) {
    return (this.database.query(`
      SELECT message_json
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY sequence
    `).all(id) as Array<{ message_json: string }>)
      .map(row => JSON.parse(row.message_json) as ConversationMessage);
  }

  saveTurn(input: {
    conversationId: string;
    title: string;
    userMessage: ConversationMessage;
    assistantMessage: ConversationMessage;
    occurredAt: string;
  }) {
    this.database.transaction(() => {
      const current = this.database.query(
        "SELECT * FROM conversations WHERE id = ? AND is_deleted = 0",
      ).get(input.conversationId) as Record<string, unknown> | null;
      const changeId = `conversation-turn:${crypto.randomUUID()}`;
      this.database.query(`
        INSERT INTO changes (id, occurred_at, actor, source, summary, status)
        VALUES (?, ?, 'GigFinderAgent', 'agent', ?, 'committed')
      `).run(changeId, input.occurredAt, `Save conversation ${input.conversationId} turn`);
      if (current) {
        this.database.query(`
          INSERT INTO conversation_history (
            change_id, operation, recorded_at, recorded_by,
            id, title, last_active_at, revision, is_deleted, created_at, updated_at
          ) VALUES (?, 'update', ?, 'GigFinderAgent', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          changeId,
          input.occurredAt,
          current.id as SQLQueryBindings,
          current.title as SQLQueryBindings,
          current.last_active_at as SQLQueryBindings,
          current.revision as SQLQueryBindings,
          current.is_deleted as SQLQueryBindings,
          current.created_at as SQLQueryBindings,
          current.updated_at as SQLQueryBindings,
        );
        this.database.query(`
          UPDATE conversations
          SET title = ?, last_active_at = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND is_deleted = 0
        `).run(input.title, input.occurredAt, input.occurredAt, input.conversationId);
      } else {
        this.database.query(`
          INSERT INTO conversations (
            id, title, last_active_at, revision, is_deleted, created_at, updated_at
          ) VALUES (?, ?, ?, 1, 0, ?, ?)
        `).run(
          input.conversationId,
          input.title,
          input.occurredAt,
          input.occurredAt,
          input.occurredAt,
        );
      }
      const sequence = (this.database.query(`
        SELECT coalesce(max(sequence), 0) AS value
        FROM conversation_messages WHERE conversation_id = ?
      `).get(input.conversationId) as { value: number }).value;
      const insert = this.database.query(`
        INSERT INTO conversation_messages (
          id, conversation_id, sequence, message_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      insert.run(
        input.userMessage.id,
        input.conversationId,
        sequence + 1,
        JSON.stringify(input.userMessage),
        input.occurredAt,
      );
      insert.run(
        input.assistantMessage.id,
        input.conversationId,
        sequence + 2,
        JSON.stringify(input.assistantMessage),
        input.occurredAt,
      );
    })();
  }
}
