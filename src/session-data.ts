/**
 * Session panel data extraction.
 *
 * Formats session list items and previews for the session selector.
 */

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
 * Returns lines of text.
 */
export function formatSessionPreview(session: SessionItem, width: number): string[] {
  const lines: string[] = [];
  const sep = "─".repeat(Math.min(width, 60));

  // Header
  if (session.name) {
    lines.push(`📌 ${session.name}`);
  }

  lines.push(sep);

  // Metadata
  lines.push(`📁 ${session.cwd}`);
  lines.push(`💬 ${session.messageCount} messages`);
  lines.push(`📅 Created: ${session.created.toLocaleString()}`);
  lines.push(`📅 Modified: ${session.modified.toLocaleString()}`);

  if (session.parentSessionPath) {
    lines.push(`🔗 Forked from: ${session.parentSessionPath}`);
  }

  lines.push(sep);

  // First message preview
  lines.push("First message:");
  const firstMsg = session.firstMessage || "(empty)";
  const truncated =
    firstMsg.length > 500 ? firstMsg.slice(0, 500) + "..." : firstMsg;
  lines.push(truncated);

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
