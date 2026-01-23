import "server-only";
import type { Statement } from "better-sqlite3";
import { getDb } from "./client";

export type Thread = {
  id: string;
  title: string;
  created_at: number;
};

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type Message = {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  created_at: number;
};

export type CreateThreadInput = {
  title: string;
  id?: string;
  createdAt?: number;
};

export type SaveMessageInput = {
  threadId: string;
  role: MessageRole;
  content: string;
  id?: string;
  createdAt?: number;
};

// Cached statements
type DbStatement = Statement<unknown[], unknown>;

type Statements = {
  insertThread: DbStatement | null;
  listThreads: DbStatement | null;
  insertMessage: DbStatement | null;
  listMessagesByThread: DbStatement | null;
  deleteThread: DbStatement | null;
};

const statements: Statements = {
  insertThread: null,
  listThreads: null,
  insertMessage: null,
  listMessagesByThread: null,
  deleteThread: null,
};

function getStatements() {
  const db = getDb();

  // Prepare and cache statements once for reuse.
  if (!statements.insertThread) {
    statements.insertThread = db.prepare(
      "INSERT INTO threads (id, title, created_at) VALUES (?, ?, ?)"
    );
  }

  if (!statements.listThreads) {
    statements.listThreads = db.prepare(
      "SELECT id, title, created_at FROM threads ORDER BY created_at DESC LIMIT ? OFFSET ?"
    );
  }

  if (!statements.insertMessage) {
    statements.insertMessage = db.prepare(
      "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    );
  }

  if (!statements.listMessagesByThread) {
    statements.listMessagesByThread = db.prepare(
      "SELECT id, thread_id, role, content, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
    );
  }

  if (!statements.deleteThread) {
    statements.deleteThread = db.prepare("DELETE FROM threads WHERE id = ?");
  }

  return statements;
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  // Create a new thread record with a generated UUID.
  const thread: Thread = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title,
    created_at: input.createdAt ?? Date.now(),
  };

  const { insertThread } = getStatements();
  insertThread?.run(thread.id, thread.title, thread.created_at);

  return thread;
}

export async function getThreads(
  limit = 50,
  offset = 0
): Promise<Thread[]> {
  // Return threads ordered by most recent first.
  const { listThreads } = getStatements();
  return (listThreads?.all(limit, offset) as Thread[]) ?? [];
}

export async function saveMessage(
  input: SaveMessageInput
): Promise<Message> {
  // Persist a message linked to its thread.
  const message: Message = {
    id: input.id ?? crypto.randomUUID(),
    thread_id: input.threadId,
    role: input.role,
    content: input.content,
    created_at: input.createdAt ?? Date.now(),
  };

  const { insertMessage } = getStatements();
  insertMessage?.run(
    message.id,
    message.thread_id,
    message.role,
    message.content,
    message.created_at
  );

  return message;
}

export async function getMessagesByThread(
  threadId: string,
  limit = 200,
  offset = 0
): Promise<Message[]> {
  // Return messages in chronological order for the thread.
  const { listMessagesByThread } = getStatements();
  return (listMessagesByThread?.all(threadId, limit, offset) as Message[]) ?? [];
}

export async function deleteThread(threadId: string): Promise<void> {
  // Deleting the thread cascades to its messages via foreign key.
  const { deleteThread: deleteThreadStatement } = getStatements();
  deleteThreadStatement?.run(threadId);
}
