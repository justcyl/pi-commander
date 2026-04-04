/**
 * Peak panel data extraction.
 *
 * Extracts "turns" from session branch entries.
 * A turn = one user message + subsequent assistant/toolResult messages
 * until the next user message.
 */

// Minimal types mirroring pi's session entry types (avoids hard dependency for testing)
export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role: string;
    content?: string | ContentBlock[];
    timestamp?: number;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
  summary?: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface Turn {
  /** The user message entry that starts this turn */
  userEntry: SessionEntry;
  /** All assistant message entries in this turn */
  assistantEntries: SessionEntry[];
  /** All tool result entries in this turn */
  toolResultEntries: SessionEntry[];
  /** Turn index (0-based) */
  index: number;
}

export interface TurnAnchor {
  turnIndex: number;
  preview: string;
  entryId: string;
}

const PREVIEW_MAX_LEN = 80;

/**
 * Extract turns from a flat list of session branch entries.
 * A turn starts at each user message and includes everything until the next user message.
 */
export function extractTurns(entries: SessionEntry[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;

    const role = entry.message.role;

    if (role === "user") {
      // Start a new turn
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = {
        userEntry: entry,
        assistantEntries: [],
        toolResultEntries: [],
        index: turns.length,
      };
    } else if (currentTurn) {
      if (role === "assistant") {
        currentTurn.assistantEntries.push(entry);
      } else if (role === "toolResult") {
        currentTurn.toolResultEntries.push(entry);
      }
    }
  }

  // Push last turn
  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}

/**
 * Extract the text content from a message's content field.
 */
export function extractTextContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

/**
 * Create anchors (left-pane items) from turns.
 * Each anchor shows a truncated preview of the user message.
 */
export function extractAnchors(turns: Turn[]): TurnAnchor[] {
  return turns.map((turn) => {
    const text = extractTextContent(turn.userEntry.message?.content);
    const singleLine = text.replace(/\n/g, " ").trim();
    const preview =
      singleLine.length > PREVIEW_MAX_LEN
        ? singleLine.slice(0, PREVIEW_MAX_LEN) + "..."
        : singleLine;

    return {
      turnIndex: turn.index,
      preview,
      entryId: turn.userEntry.id,
    };
  });
}

/**
 * Filter anchors by case-insensitive substring match.
 */
export function filterAnchors(anchors: TurnAnchor[], query: string): TurnAnchor[] {
  if (!query) return anchors;
  const lower = query.toLowerCase();
  return anchors.filter((a) => a.preview.toLowerCase().includes(lower));
}

/**
 * Format a full turn for the right-pane preview.
 * Returns an array of plain-text lines (TUI rendering adds styling later).
 */
export function formatTurnPreview(turn: Turn, width: number): string {
  const lines: string[] = [];
  const sep = "─".repeat(Math.min(width, 60));

  // User message
  lines.push("┌ User");
  lines.push(sep);
  const userText = extractTextContent(turn.userEntry.message?.content);
  lines.push(userText);
  lines.push("");

  // Assistant + tool calls interleaved
  for (const aEntry of turn.assistantEntries) {
    const blocks = aEntry.message?.content;
    if (!blocks) continue;

    lines.push("┌ Assistant");
    lines.push(sep);

    if (typeof blocks === "string") {
      lines.push(blocks);
    } else if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          lines.push(block.text);
        } else if (block.type === "toolCall") {
          lines.push(`  ⚡ ${block.name}(${summarizeArgs(block.arguments)})`);
        } else if (block.type === "thinking" && block.thinking) {
          const preview =
            block.thinking.length > 200
              ? block.thinking.slice(0, 200) + "..."
              : block.thinking;
          lines.push(`  💭 ${preview}`);
        }
      }
    }
    lines.push("");
  }

  // Tool results
  for (const trEntry of turn.toolResultEntries) {
    const msg = trEntry.message!;
    const resultText = extractTextContent(msg.content);
    const truncated =
      resultText.length > 500 ? resultText.slice(0, 500) + "\n... (truncated)" : resultText;

    lines.push(`┌ Tool Result: ${msg.toolName} ${msg.isError ? "❌" : "✓"}`);
    lines.push(sep);
    lines.push(truncated);
    lines.push("");
  }

  return lines.join("\n");
}

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const s = String(v);
      return `${k}: ${s.length > 40 ? s.slice(0, 40) + "..." : s}`;
    })
    .join(", ");
}
