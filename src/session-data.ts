/**
 * Session panel data extraction.
 *
 * Formats session list items and previews for the session selector.
 */

import { readFileSync } from "node:fs";

export interface SessionItem {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

export interface SessionListItem {
  label: string;
  meta: string;
  sessionItem: SessionItem;
}

const LABEL_MAX_LEN = 80;

/**
 * Format a session into a list item for the left pane.
 */
export function formatSessionList(session: SessionItem): SessionListItem {
  // Label: name or truncated first message
  const rawLabel = session.name || session.firstMessage || "(empty session)";
  const singleLine = rawLabel.replace(/\n/g, " ").trim();
  const label =
    singleLine.length > LABEL_MAX_LEN
      ? singleLine.slice(0, LABEL_MAX_LEN) + "..."
      : singleLine;

  // Meta: message count + relative time
  const relTime = formatRelativeTime(session.modified);
  const meta = `${session.messageCount} msgs · ${relTime}`;

  return { label, meta, sessionItem: session };
}

/**
 * Filter sessions by query (case-insensitive search in name, firstMessage, allMessagesText).
 */
export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
  if (!query) return sessions;
  const lower = query.toLowerCase();
  return sessions.filter((s) => {
    const searchable = [s.name, s.firstMessage, s.allMessagesText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(lower);
  });
}

/**
 * Format a session preview for the right pane.
 * Shows metadata header, then role-tagged conversation messages.
 */
export function formatSessionPreview(session: SessionItem, width: number): string[] {
  const lines: string[] = [];

  // Metadata header
  const relTime = formatRelativeTime(session.modified);
  lines.push(`[meta] ${session.id}  ${session.messageCount} msgs  ${relTime}`);
  lines.push("─".repeat(Math.min(width - 1, 50)));

  // Load role-tagged messages from session file
  const messages = loadSessionMessages(session.path);
  if (messages.length > 0) {
    for (const msg of messages) {
      const tag = msg.role === "user" ? "[U]" : "[A]";
      const msgLines = msg.text.split("\n");
      for (const ml of msgLines) {
        if (ml.trim()) lines.push(`${tag} ${ml}`);
      }
    }
  } else {
    // Fallback to flat text
    const text = session.allMessagesText || session.firstMessage || "(empty)";
    const wrapped = wrapText(text, Math.max(10, width - 1));
    lines.push(...wrapped);
  }

  return lines;
}

interface RoleMessage {
  role: "user" | "assistant";
  text: string;
}

/** Cache for loaded session messages. */
const messageCache = new Map<string, RoleMessage[]>();

/**
 * Load user/assistant messages from a session JSONL file.
 * Cached per session path.
 */
function loadSessionMessages(sessionPath: string): RoleMessage[] {
  if (messageCache.has(sessionPath)) return messageCache.get(sessionPath)!;

  const messages: RoleMessage[] = [];
  try {
    const content = readFileSync(sessionPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;

        let text = "";
        const c = entry.message.content;
        if (typeof c === "string") {
          text = c;
        } else if (Array.isArray(c)) {
          text = c
            .filter((b: any) => b.type === "text" && b.text)
            .map((b: any) => b.text)
            .join("\n");
        }
        text = text.trim();
        if (text) messages.push({ role, text });
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file not readable
  }

  messageCache.set(sessionPath, messages);
  return messages;
}

/** Simple word-wrap for plain text. */
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\n/);
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (current.length + word.length + 1 > maxWidth) {
        if (current) lines.push(current);
        current = word.length > maxWidth ? word.slice(0, maxWidth) : word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Format a relative time string (e.g., "2h ago", "3d ago").
 */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
