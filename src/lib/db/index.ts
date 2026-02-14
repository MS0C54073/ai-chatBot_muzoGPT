/**
 * Database Operations Module
 * 
 * Provides server-side API for managing chat threads, messages, and file uploads.
 * Uses better-sqlite3 for synchronous access with automatic schema initialization.
 * 
 * Key features:
 * - Thread CRUD operations (create, list, delete)
 * - Message persistence and retrieval per thread
 * - Message editing and regeneration (delete subsequent messages)
 * - File upload metadata tracking
 * - Automatic statement caching for performance
 * 
 * All operations are transaction-safe when used correctly.
 */

import "server-only";
import type { Statement } from "better-sqlite3";
import { getDb } from "./client";

export type Thread = {
  id: string;
  title: string;
  created_at: number;
};

/** Role of a message in the conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/**
 * Message record in the database
 * @property {string} id - Unique identifier (UUID)
 * @property {string} thread_id - Foreign key linking to a thread
 * @property {MessageRole} role - Message role (user, assistant, tool, or system)
 * @property {string} content - Message text content
 * @property {number} created_at - UNIX timestamp of when the message was created
 */
export type Message = {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  created_at: number;
};

/**
 * File upload record in the database
 * @property {string} id - Unique identifier (UUID)
 * @property {string} filename - Original filename provided by user
 * @property {string} mime_type - MIME type (e.g., "text/plain", "application/json")
 * @property {number} size_bytes - File size in bytes
 * @property {string} storage_path - Absolute path to stored file
 * @property {number} created_at - UNIX timestamp of when the file was uploaded
 */
export type Upload = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: number;
};

/**
 * Input for creating a new thread
 * @property {string} title - Display name for the thread
 * @property {string} [id] - Optional custom UUID (auto-generated if omitted)
 * @property {number} [createdAt] - Optional creation timestamp (current time if omitted)
 */
export type CreateThreadInput = {
  title: string;
  id?: string;
  createdAt?: number;
};

/**
 * Input for saving a message to the database
 * @property {string} threadId - Thread UUID this message belongs to
 * @property {MessageRole} role - Message role
 * @property {string} content - Message text
 * @property {string} [id] - Optional message UUID (auto-generated if omitted)
 * @property {number} [createdAt] - Optional creation timestamp (current time if omitted)
 */
export type SaveMessageInput = {
  threadId: string;
  role: MessageRole;
  content: string;
  id?: string;
  createdAt?: number;
};

/**
 * Input for updating an existing message
 * @property {string} id - Message UUID to update
 * @property {string} content - New message content (replaces existing)
 */
export type UpdateMessageInput = {
  id: string;
  content: string;
};

/**
 * Input for saving file upload metadata
 * @property {string} filename - Original filename
 * @property {string} mimeType - MIME type
 * @property {number} sizeBytes - File size in bytes
 * @property {string} storagePath - Absolute path to stored file
 * @property {string} [id] - Optional UUID (auto-generated if omitted)
 * @property {number} [createdAt] - Optional timestamp (current time if omitted)
 */
export type SaveUploadInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  id?: string;
  createdAt?: number;
};

// Cached prepared statements for reuse
// Prepared statements are compiled once and can be executed multiple times efficiently
type DbStatement = Statement<unknown[], unknown>;

/**
 * Holds references to all prepared SQL statements.
 * Using prepared statements improves performance and prevents SQL injection.
 */
type Statements = {
  insertThread: DbStatement | null;
  listThreads: DbStatement | null;
  insertMessage: DbStatement | null;
  listMessagesByThread: DbStatement | null;
  deleteThread: DbStatement | null;
  updateThread: DbStatement | null;
  insertUpload: DbStatement | null;
  getUpload: DbStatement | null;
  updateMessage: DbStatement | null;
  deleteMessage: DbStatement | null;
  getMessage: DbStatement | null;
  deleteMessagesAfter: DbStatement | null;
};

const statements: Statements = {
  insertThread: null,
  listThreads: null,
  insertMessage: null,
  listMessagesByThread: null,
  deleteThread: null,
  updateThread: null,
  insertUpload: null,
  getUpload: null,
  updateMessage: null,
  deleteMessage: null,
  getMessage: null,
  deleteMessagesAfter: null,
};

/**
 * Lazy-initializes and caches all prepared SQL statements.
 * Statements are compiled once on first call and reused for all subsequent operations.
 * This improves performance and reduces database parsing overhead.
 * @returns {Statements} Object with all cached statement references
 */
function getStatements() {
  const db = getDb();

  // Initialize each statement only once on first call
  // All subsequent calls reuse the same compiled statement
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

  if (!statements.updateThread) {
    statements.updateThread = db.prepare(
      "UPDATE threads SET title = ? WHERE id = ?"
    );
  }

  if (!statements.insertUpload) {
    statements.insertUpload = db.prepare(
      "INSERT INTO uploads (id, filename, mime_type, size_bytes, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
  }

  if (!statements.getUpload) {
    statements.getUpload = db.prepare(
      "SELECT id, filename, mime_type, size_bytes, storage_path, created_at FROM uploads WHERE id = ?"
    );
  }

  if (!statements.updateMessage) {
    statements.updateMessage = db.prepare(
      "UPDATE messages SET content = ? WHERE id = ?"
    );
  }

  if (!statements.deleteMessage) {
    statements.deleteMessage = db.prepare("DELETE FROM messages WHERE id = ?");
  }

  if (!statements.getMessage) {
    statements.getMessage = db.prepare(
      "SELECT id, thread_id, role, content, created_at FROM messages WHERE id = ?"
    );
  }

  if (!statements.deleteMessagesAfter) {
    statements.deleteMessagesAfter = db.prepare(
      "DELETE FROM messages WHERE thread_id = ? AND created_at > ?"
    );
  }

  return statements;
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  // Create a new thread record with a generated UUID.
  /**
   * Creates a new conversation thread.
   * Auto-generates UUID and creation timestamp if not provided.
   * @param {CreateThreadInput} input - Thread creation parameters
   * @returns {Promise<Thread>} The newly created thread
   */
  const thread: Thread = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title,
    created_at: input.createdAt ?? Date.now(),
  };

  const { insertThread } = getStatements();
  insertThread?.run(thread.id, thread.title, thread.created_at);

  return thread;
}

/**
 * Retrieves paginated list of conversation threads, ordered most recent first.
 * @param {number} [limit=50] - Maximum number of threads to return
 * @param {number} [offset=0] - Number of threads to skip (for pagination)
 * @returns {Promise<Thread[]>} Array of thread records
 */
export async function getThreads(
  limit = 50,
  offset = 0
): Promise<Thread[]> {
  // Return threads ordered by most recent first.
  const { listThreads } = getStatements();
  return (listThreads?.all(limit, offset) as Thread[]) ?? [];
}

/**
 * Persists a message to the database linked to a specific thread.
 * Auto-generates UUID and timestamp if not provided.
 * @param {SaveMessageInput} input - Message data (threadId, role, content)
 * @returns {Promise<Message>} The persisted message record
 */
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

/**
 * Retrieves all messages for a specific thread in chronological order.
 * @param {string} threadId - UUID of the thread
 * @param {number} [limit=200] - Maximum number of messages to return
 * @param {number} [offset=0] - Number of messages to skip (for pagination)
 * @returns {Promise<Message[]>} Array of message records in creation order
 */
export async function getMessagesByThread(
  threadId: string,
  limit = 200,
  offset = 0
): Promise<Message[]> {
  // Return messages in chronological order for the thread.
  const { listMessagesByThread } = getStatements();
  return (listMessagesByThread?.all(threadId, limit, offset) as Message[]) ?? [];
}

/**
 * Deletes a thread and all its associated messages (via foreign key cascade).
 * @param {string} threadId - UUID of the thread to delete
 * @returns {Promise<void>}
 */
export async function deleteThread(threadId: string): Promise<void> {
  // Deleting the thread cascades to its messages via foreign key.
  const { deleteThread: deleteThreadStatement } = getStatements();
  deleteThreadStatement?.run(threadId);
}

/**
 * Updates the title of a thread.
 * @param {string} threadId - UUID of the thread to update
 * @param {string} title - New title for the thread
 * @returns {Promise<void>}
 */
export async function updateThread(
  threadId: string,
  title: string
): Promise<void> {
  const { updateThread: updateThreadStatement } = getStatements();
  updateThreadStatement?.run(title, threadId);
}

/**
 * Updates the content of an existing message.
 * Used for editing sent messages while keeping the original message ID.
 * @param {UpdateMessageInput} input - Message ID and new content
 * @returns {Promise<void>}
 */
export async function updateMessage(
  input: UpdateMessageInput
): Promise<void> {
  // Update replaces the entire message content and preserves the message ID and timestamp
  const { updateMessage: updateMessageStatement } = getStatements();
  updateMessageStatement?.run(input.content, input.id);
}

/**
 * Deletes a single message from the database.
 * @param {string} messageId - UUID of the message to delete
 * @returns {Promise<void>}
 */
export async function deleteMessage(messageId: string): Promise<void> {
  const { deleteMessage: deleteMessageStatement } = getStatements();
  deleteMessageStatement?.run(messageId);
}

/**
 * Retrieves a single message by its ID.
 * @param {string} id - UUID of the message
 * @returns {Promise<Message | null>} The message record or null if not found
 */
export async function getMessageById(id: string): Promise<Message | null> {
  const { getMessage } = getStatements();
  return (getMessage?.get(id) as Message | undefined) ?? null;
}

/**
 * Deletes all messages in a thread that were created after a specific timestamp.
 * Used to remove follow-up messages when regenerating a response at an earlier point.
 * @param {string} threadId - UUID of the thread
 * @param {number} createdAt - UNIX timestamp; messages after this are deleted
 * @returns {Promise<void>}
 */
export async function deleteMessagesAfter(
  threadId: string,
  createdAt: number
): Promise<void> {
  const { deleteMessagesAfter: deleteMessagesAfterStatement } = getStatements();
  deleteMessagesAfterStatement?.run(threadId, createdAt);
}

/**
 * Persists file upload metadata to the database.
 * Auto-generates UUID and timestamp if not provided.
 * @param {SaveUploadInput} input - Upload metadata (filename, mimeType, size, path)
 * @returns {Promise<Upload>} The persisted upload record
 */
export async function saveUpload(input: SaveUploadInput): Promise<Upload> {
  const upload: Upload = {
    id: input.id ?? crypto.randomUUID(),
    filename: input.filename,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    storage_path: input.storagePath,
    created_at: input.createdAt ?? Date.now(),
  };

  const { insertUpload } = getStatements();
  insertUpload?.run(
    upload.id,
    upload.filename,
    upload.mime_type,
    upload.size_bytes,
    upload.storage_path,
    upload.created_at
  );

  return upload;
}

/**
 * Retrieves file upload metadata by ID.
 * @param {string} id - UUID of the upload
 * @returns {Promise<Upload | null>} The upload record or null if not found
 */
export async function getUploadById(id: string): Promise<Upload | null> {
  const { getUpload } = getStatements();
  return (getUpload?.get(id) as Upload | undefined) ?? null;
}
