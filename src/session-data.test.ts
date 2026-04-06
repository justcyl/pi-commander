/**
 * Tests for Session panel data extraction logic.
 */
import { describe, it, expect } from "vitest";
import {
  type SessionItem,
  formatSessionList,
  filterSessions,
  formatSessionPreview,
} from "./session-data.js";

// --- Test fixtures ---

function makeSessionInfo(overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    path: "/home/user/.pi/agent/sessions/--test--/12345_abc.jsonl",
    id: "abc-123",
    cwd: "/home/user/project",
    created: new Date("2026-04-01T10:00:00Z"),
    modified: new Date("2026-04-01T12:00:00Z"),
    messageCount: 20,
    firstMessage: "Hello, help me with my project",
    allMessagesText: "Hello help me project code fix bug test",
    ...overrides,
  };
}

// --- Tests ---

describe("formatSessionList", () => {
  it("should format session with name", () => {
    const session = makeSessionInfo({ name: "Auth Refactor" });
    const result = formatSessionList(session);
    expect(result.label).toContain("Auth Refactor");
    expect(result.meta).toContain("20");
  });

  it("should fallback to first message when no name", () => {
    const session = makeSessionInfo({ name: undefined });
    const result = formatSessionList(session);
    expect(result.label).toContain("Hello, help me");
  });

  it("should truncate long first messages", () => {
    const session = makeSessionInfo({
      name: undefined,
      firstMessage: "A".repeat(200),
    });
    const result = formatSessionList(session);
    expect(result.label.length).toBeLessThanOrEqual(83);
  });

  it("should include relative time", () => {
    const now = new Date();
    const session = makeSessionInfo({ modified: now });
    const result = formatSessionList(session);
    // Should contain some time indicator
    expect(result.meta.length).toBeGreaterThan(0);
  });
});

describe("filterSessions", () => {
  it("should filter by name", () => {
    const sessions = [
      makeSessionInfo({ name: "Auth Module", id: "1" }),
      makeSessionInfo({ name: "Database Setup", id: "2" }),
      makeSessionInfo({ name: "Auth Tests", id: "3" }),
    ];
    const filtered = filterSessions(sessions, "auth");
    expect(filtered).toHaveLength(2);
  });

  it("should filter by first message when no name", () => {
    const sessions = [
      makeSessionInfo({ firstMessage: "fix the bug in login", allMessagesText: "fix the bug in login", id: "1" }),
      makeSessionInfo({ firstMessage: "add new feature", allMessagesText: "add new feature", id: "2" }),
    ];
    const filtered = filterSessions(sessions, "bug");
    expect(filtered).toHaveLength(1);
  });

  it("should search allMessagesText", () => {
    const sessions = [
      makeSessionInfo({
        firstMessage: "hello",
        allMessagesText: "hello refactor database schema",
        id: "1",
      }),
      makeSessionInfo({
        firstMessage: "hi",
        allMessagesText: "hi fix ui styling",
        id: "2",
      }),
    ];
    const filtered = filterSessions(sessions, "database");
    expect(filtered).toHaveLength(1);
  });

  it("should return all when query is empty", () => {
    const sessions = [
      makeSessionInfo({ id: "1" }),
      makeSessionInfo({ id: "2" }),
    ];
    expect(filterSessions(sessions, "")).toHaveLength(2);
  });
});

describe("formatSessionPreview", () => {
  it("should produce non-empty preview", () => {
    const session = makeSessionInfo({ name: "Test Session" });
    const preview = formatSessionPreview(session, 80);
    expect(preview.length).toBeGreaterThan(0);
  });

  it("should show ID and date metadata header", () => {
    const session = makeSessionInfo({
      id: "abc-123",
      messageCount: 42,
      allMessagesText: "Hello help me project",
    });
    const preview = formatSessionPreview(session, 80);
    const text = preview.join("\n");
    expect(text).toContain("abc-123");
    expect(text).toContain("42");
    expect(text).toContain("Hello");
  });

  it("should fallback to firstMessage when allMessagesText is empty", () => {
    const session = makeSessionInfo({
      allMessagesText: "",
      firstMessage: "Hello, help me",
    });
    const preview = formatSessionPreview(session, 80);
    const text = preview.join(" ");
    expect(text).toContain("Hello");
  });

  it("should word-wrap long text", () => {
    const session = makeSessionInfo({
      allMessagesText: "word ".repeat(100),
    });
    const preview = formatSessionPreview(session, 40);
    // Should produce multiple lines
    expect(preview.length).toBeGreaterThan(1);
    // Each line should fit within width
    for (const line of preview) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});
