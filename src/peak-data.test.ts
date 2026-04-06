/**
 * Tests for Peak panel data extraction logic.
 *
 * Peak panel: left pane shows user messages as "turn anchors",
 * right pane shows the full turn (user + assistant + tool calls).
 */
import { describe, it, expect } from "vitest";
import {
  type Turn,
  type TurnAnchor,
  extractTurns,
  extractAnchors,
  filterAnchors,
  formatTurnPreview,
} from "./peak-data.js";

// --- Test fixtures ---

function makeUserEntry(id: string, parentId: string | null, content: string, ts = 1000) {
  return {
    type: "message" as const,
    id,
    parentId,
    timestamp: new Date(ts).toISOString(),
    message: {
      role: "user" as const,
      content,
      timestamp: ts,
    },
  };
}

function makeAssistantEntry(
  id: string,
  parentId: string,
  textContent: string,
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [],
  ts = 2000
) {
  const content: any[] = [{ type: "text", text: textContent }];
  for (const tc of toolCalls) {
    content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.arguments });
  }
  return {
    type: "message" as const,
    id,
    parentId,
    timestamp: new Date(ts).toISOString(),
    message: {
      role: "assistant" as const,
      content,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      api: "messages",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as const,
      timestamp: ts,
    },
  };
}

function makeToolResultEntry(id: string, parentId: string, toolCallId: string, toolName: string, text: string, ts = 3000) {
  return {
    type: "message" as const,
    id,
    parentId,
    timestamp: new Date(ts).toISOString(),
    message: {
      role: "toolResult" as const,
      toolCallId,
      toolName,
      content: [{ type: "text" as const, text }],
      isError: false,
      timestamp: ts,
    },
  };
}

function makeCompactionEntry(id: string, parentId: string, summary: string) {
  return {
    type: "compaction" as const,
    id,
    parentId,
    timestamp: new Date(500).toISOString(),
    summary,
    firstKeptEntryId: parentId,
    tokensBefore: 50000,
  };
}

// --- Tests ---

describe("extractTurns", () => {
  it("should extract a single turn with user + assistant", () => {
    const entries = [
      makeUserEntry("u1", null, "Hello"),
      makeAssistantEntry("a1", "u1", "Hi there!"),
    ];
    const turns = extractTurns(entries as any);
    expect(turns).toHaveLength(1);
    expect(turns[0].userEntry.id).toBe("u1");
    expect(turns[0].assistantEntries).toHaveLength(1);
    expect(turns[0].toolResultEntries).toHaveLength(0);
  });

  it("should extract multiple turns", () => {
    const entries = [
      makeUserEntry("u1", null, "Hello"),
      makeAssistantEntry("a1", "u1", "Hi!"),
      makeUserEntry("u2", "a1", "How are you?"),
      makeAssistantEntry("a2", "u2", "Good!"),
    ];
    const turns = extractTurns(entries as any);
    expect(turns).toHaveLength(2);
    expect(turns[0].userEntry.id).toBe("u1");
    expect(turns[1].userEntry.id).toBe("u2");
  });

  it("should group tool results with their turn", () => {
    const entries = [
      makeUserEntry("u1", null, "Run ls"),
      makeAssistantEntry("a1", "u1", "Sure", [{ id: "tc1", name: "bash", arguments: { command: "ls" } }]),
      makeToolResultEntry("tr1", "a1", "tc1", "bash", "file1.ts\nfile2.ts"),
      makeAssistantEntry("a2", "tr1", "Here are your files"),
    ];
    const turns = extractTurns(entries as any);
    expect(turns).toHaveLength(1);
    expect(turns[0].toolResultEntries).toHaveLength(1);
    expect(turns[0].assistantEntries).toHaveLength(2);
  });

  it("should handle entries starting with compaction", () => {
    const entries = [
      makeCompactionEntry("c1", null, "Previous conversation summary"),
      makeUserEntry("u1", "c1", "Continue please"),
      makeAssistantEntry("a1", "u1", "OK"),
    ];
    const turns = extractTurns(entries as any);
    expect(turns).toHaveLength(1);
    expect(turns[0].userEntry.id).toBe("u1");
  });

  it("should return empty for no user messages", () => {
    const entries = [
      makeCompactionEntry("c1", null, "Summary"),
    ];
    const turns = extractTurns(entries as any);
    expect(turns).toHaveLength(0);
  });
});

describe("extractAnchors", () => {
  it("should create anchors from turns", () => {
    const entries = [
      makeUserEntry("u1", null, "Hello world, this is a long message"),
      makeAssistantEntry("a1", "u1", "Response"),
    ];
    const turns = extractTurns(entries as any);
    const anchors = extractAnchors(turns);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].turnIndex).toBe(0);
    expect(anchors[0].preview).toContain("Hello world");
  });

  it("should truncate long previews", () => {
    const longMsg = "A".repeat(200);
    const entries = [
      makeUserEntry("u1", null, longMsg),
      makeAssistantEntry("a1", "u1", "Response"),
    ];
    const turns = extractTurns(entries as any);
    const anchors = extractAnchors(turns);
    expect(anchors[0].preview.length).toBeLessThanOrEqual(83); // 80 + "..."
  });

  it("should handle content array format", () => {
    const entry = {
      type: "message" as const,
      id: "u1",
      parentId: null,
      timestamp: new Date(1000).toISOString(),
      message: {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Array content" }],
        timestamp: 1000,
      },
    };
    const turns = extractTurns([entry, makeAssistantEntry("a1", "u1", "OK")] as any);
    const anchors = extractAnchors(turns);
    expect(anchors[0].preview).toContain("Array content");
  });
});

describe("filterAnchors", () => {
  it("should filter by substring match", () => {
    const anchors: TurnAnchor[] = [
      { turnIndex: 0, preview: "Hello world", entryId: "u1" },
      { turnIndex: 1, preview: "Goodbye moon", entryId: "u2" },
      { turnIndex: 2, preview: "Hello again", entryId: "u3" },
    ];
    const filtered = filterAnchors(anchors, "hello");
    expect(filtered).toHaveLength(2);
    expect(filtered[0].turnIndex).toBe(0);
    expect(filtered[1].turnIndex).toBe(2);
  });

  it("should return all when query is empty", () => {
    const anchors: TurnAnchor[] = [
      { turnIndex: 0, preview: "A", entryId: "u1" },
      { turnIndex: 1, preview: "B", entryId: "u2" },
    ];
    expect(filterAnchors(anchors, "")).toHaveLength(2);
  });
});

describe("formatTurnPreview", () => {
  it("should format a simple user+assistant turn", () => {
    const entries = [
      makeUserEntry("u1", null, "What is 2+2?"),
      makeAssistantEntry("a1", "u1", "The answer is 4."),
    ];
    const turns = extractTurns(entries as any);
    const preview = formatTurnPreview(turns[0], 80);
    expect(preview).toContain("What is 2+2?");
    expect(preview).toContain("The answer is 4.");
    // Uses [U]/[A] role tags
    expect(preview).toContain("[U]");
    expect(preview).toContain("[A]");
  });

  it("should filter out tool calls and results", () => {
    const entries = [
      makeUserEntry("u1", null, "Run ls"),
      makeAssistantEntry("a1", "u1", "Sure", [{ id: "tc1", name: "bash", arguments: { command: "ls" } }]),
      makeToolResultEntry("tr1", "a1", "tc1", "bash", "file1.ts"),
      makeAssistantEntry("a2", "tr1", "Done"),
    ];
    const turns = extractTurns(entries as any);
    const preview = formatTurnPreview(turns[0], 80);
    expect(preview).toContain("Run ls");
    expect(preview).toContain("Sure");
    expect(preview).toContain("Done");
    expect(preview).not.toContain("file1.ts");
    expect(preview).not.toContain("bash");
  });

  it("should not contain tool output", () => {
    const longResult = "x".repeat(1000);
    const entries = [
      makeUserEntry("u1", null, "Run cmd"),
      makeAssistantEntry("a1", "u1", "OK", [{ id: "tc1", name: "bash", arguments: { command: "big" } }]),
      makeToolResultEntry("tr1", "a1", "tc1", "bash", longResult),
    ];
    const turns = extractTurns(entries as any);
    const preview = formatTurnPreview(turns[0], 80);
    expect(preview).toContain("Run cmd");
    expect(preview).toContain("OK");
    expect(preview).not.toContain("xxxx");
  });
});
