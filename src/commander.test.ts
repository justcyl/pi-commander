/**
 * Tests for CommanderComponent rendering and input handling.
 * These test the component logic without requiring a real TUI.
 */
import { describe, it, expect, vi } from "vitest";
import { extractTurns, type Turn } from "./peak-data.js";
import { formatSessionList, filterSessions, type SessionItem } from "./session-data.js";

// We can't import CommanderComponent directly (it depends on pi-tui at import time).
// Instead we test the data flow that feeds into it.

function makeEntries() {
  return [
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: new Date(1000).toISOString(),
      message: { role: "user", content: "First question about TypeScript", timestamp: 1000 },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: new Date(2000).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "TypeScript is a typed superset of JavaScript." }],
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        api: "messages",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 2000,
      },
    },
    {
      type: "message",
      id: "u2",
      parentId: "a1",
      timestamp: new Date(3000).toISOString(),
      message: { role: "user", content: "Second question about Rust", timestamp: 3000 },
    },
    {
      type: "message",
      id: "a2",
      parentId: "u2",
      timestamp: new Date(4000).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Rust is a systems programming language." },
          { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "rustc --version" } },
        ],
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        api: "messages",
        usage: { input: 15, output: 25, cacheRead: 0, cacheWrite: 0, totalTokens: 40, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 4000,
      },
    },
    {
      type: "message",
      id: "tr1",
      parentId: "a2",
      timestamp: new Date(5000).toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "bash",
        content: [{ type: "text", text: "rustc 1.75.0" }],
        isError: false,
        timestamp: 5000,
      },
    },
    {
      type: "message",
      id: "a3",
      parentId: "tr1",
      timestamp: new Date(6000).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "You have Rust 1.75.0 installed." }],
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        api: "messages",
        usage: { input: 20, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 6000,
      },
    },
  ];
}

function makeSessions(): SessionItem[] {
  return [
    {
      path: "/sessions/session1.jsonl",
      id: "s1",
      cwd: "/project/alpha",
      name: "Alpha Project Setup",
      created: new Date("2026-04-01"),
      modified: new Date("2026-04-03"),
      messageCount: 30,
      firstMessage: "Help me set up the alpha project",
      allMessagesText: "help set up alpha project typescript configuration",
    },
    {
      path: "/sessions/session2.jsonl",
      id: "s2",
      cwd: "/project/beta",
      created: new Date("2026-04-02"),
      modified: new Date("2026-04-04"),
      messageCount: 15,
      firstMessage: "Fix the database migration bug",
      allMessagesText: "fix database migration bug postgres schema",
    },
    {
      path: "/sessions/session3.jsonl",
      id: "s3",
      cwd: "/project/gamma",
      name: "Gamma Research",
      created: new Date("2026-03-28"),
      modified: new Date("2026-03-30"),
      messageCount: 50,
      firstMessage: "Research the new ML framework",
      allMessagesText: "research ML framework pytorch lightning training",
    },
  ];
}

describe("Commander data flow integration", () => {
  it("should produce correct turns from realistic entries", () => {
    const entries = makeEntries();
    const turns = extractTurns(entries as any);

    expect(turns).toHaveLength(2);

    // Turn 1: simple user + assistant
    expect(turns[0].userEntry.id).toBe("u1");
    expect(turns[0].assistantEntries).toHaveLength(1);
    expect(turns[0].toolResultEntries).toHaveLength(0);

    // Turn 2: user + assistant with tool call + tool result + follow-up assistant
    expect(turns[1].userEntry.id).toBe("u2");
    expect(turns[1].assistantEntries).toHaveLength(2); // a2 + a3
    expect(turns[1].toolResultEntries).toHaveLength(1); // tr1
  });

  it("should produce correct session list items", () => {
    const sessions = makeSessions();

    const items = sessions.map(formatSessionList);
    expect(items).toHaveLength(3);
    expect(items[0].label).toContain("Alpha Project Setup");
    expect(items[1].label).toContain("Fix the database");

    // Filter
    const filtered = filterSessions(sessions, "database");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("s2");
  });

  it("should handle empty session list", () => {
    expect(filterSessions([], "test")).toHaveLength(0);
  });

  it("should handle empty entries", () => {
    const turns = extractTurns([]);
    expect(turns).toHaveLength(0);
  });
});
