import { expect, test } from "bun:test";
import type { ConversationMessage } from "../../core/conversation-service";
import { SqliteConversationRepository } from "../conversation-store";
import { migrateDatabase, openDatabase } from "../database";

const message = (id: string, role: "user" | "assistant", text: string): ConversationMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

test("conversation turns persist atomically with ordered message rows and history", () => {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  const repository = new SqliteConversationRepository(database);
  repository.saveTurn({
    conversationId: "conversation-1",
    title: "Initial title",
    userMessage: message("user-1", "user", "Hello"),
    assistantMessage: message("assistant-1", "assistant", "Hi"),
    occurredAt: "2026-08-04T10:00:00.000Z",
  });
  repository.saveTurn({
    conversationId: "conversation-1",
    title: "Initial title",
    userMessage: message("user-2", "user", "Continue"),
    assistantMessage: message("assistant-2", "assistant", "Done"),
    occurredAt: "2026-08-04T11:00:00.000Z",
  });
  expect(repository.listRecent(20)[0]).toMatchObject({
    id: "conversation-1",
    title: "Initial title",
    lastActiveAt: "2026-08-04T11:00:00.000Z",
  });
  expect(repository.messages("conversation-1").map(item => item.id))
    .toEqual(["user-1", "assistant-1", "user-2", "assistant-2"]);
  expect(database.query("SELECT revision FROM conversations").get())
    .toEqual({ revision: 2 });
  expect(database.query("SELECT count(*) AS count FROM conversation_history").get())
    .toEqual({ count: 1 });
  database.close();
});
