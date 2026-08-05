import type { UIMessage } from "ai";
import type { Conversation } from "../../../core/conversation-service";

async function json(response: Response) {
  if (!response.ok) throw new Error(`Conversation API returned ${response.status}.`);
  return await response.json() as unknown;
}

export async function loadConversations(): Promise<Conversation[]> {
  const value = await json(await fetch("/api/agent/conversations", { cache: "no-store" }));
  return (value as { conversations: Conversation[] }).conversations;
}

export async function loadConversation(id: string): Promise<{
  conversation: Conversation;
  messages: UIMessage[];
}> {
  return await json(await fetch(
    `/api/agent/conversations/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  )) as { conversation: Conversation; messages: UIMessage[] };
}
