/**
 * Commander Extension for pi
 *
 * Ctrl+Shift+P opens a full-screen command palette with two panels:
 * - Peak: Browse conversation turns (left: user message anchors, right: full turn preview)
 * - Session: Browse and switch sessions (left: session list, right: preview)
 *
 * Also available via /commander [peak|session]
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  DynamicBorder,
  SessionManager,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Input,
  Key,
  Markdown,
  Spacer,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import type { Component, TUI } from "@mariozechner/pi-tui";

import {
  extractTurns,
  extractAnchors,
  filterAnchors,
  formatTurnPreview,
  extractTextContent,
  type Turn,
  type TurnAnchor,
} from "./peak-data.js";
import {
  formatSessionList,
  filterSessions,
  formatSessionPreview,
  type SessionItem,
  type SessionListItem,
} from "./session-data.js";

// ─── Types ───────────────────────────────────────────────────────────

type TabId = "peak" | "session";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "peak", label: "Peak" },
  { id: "session", label: "Session" },
];

// ─── Main Commander Component ────────────────────────────────────────

class CommanderComponent implements Component {
  private tui: TUI;
  private theme: any;
  private done: (result: any) => void;

  private activeTab: TabId;
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Peak state
  private turns: Turn[] = [];
  private anchors: TurnAnchor[] = [];
  private filteredAnchors: TurnAnchor[] = [];
  private peakSelectedIndex = 0;
  private peakScrollOffset = 0;
  private peakSearchMode = false;
  private peakSearchQuery = "";

  // Session state
  private sessions: SessionItem[] = [];
  private sessionItems: SessionListItem[] = [];
  private filteredSessions: SessionItem[] = [];
  private sessionSelectedIndex = 0;
  private sessionScrollOffset = 0;
  private sessionSearchMode = false;
  private sessionSearchQuery = "";
  private sessionSwitchCallback?: (path: string) => void;

  // Layout
  private leftPaneRatio = 0.35;

  constructor(
    tui: TUI,
    theme: any,
    done: (result: any) => void,
    options: {
      turns: Turn[];
      sessions: SessionItem[];
      initialTab?: TabId;
      onSessionSwitch?: (path: string) => void;
    }
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.activeTab = options.initialTab || "peak";
    this.sessionSwitchCallback = options.onSessionSwitch;

    // Init peak data
    this.turns = options.turns;
    this.anchors = extractAnchors(this.turns);
    this.filteredAnchors = this.anchors;

    // Init session data
    this.sessions = options.sessions;
    this.filteredSessions = [...this.sessions];
    this.sessionItems = this.sessions.map((s) => formatSessionList(s));
  }

  handleInput(data: string): void {
    // Tab switching: 1/2 or Tab/Shift+Tab
    if (!this.isSearchMode()) {
      if (data === "1") {
        this.activeTab = "peak";
        this.invalidate();
        return;
      }
      if (data === "2") {
        this.activeTab = "session";
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        this.activeTab = this.activeTab === "peak" ? "session" : "peak";
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.shift("tab"))) {
        this.activeTab = this.activeTab === "peak" ? "session" : "peak";
        this.invalidate();
        return;
      }
    }

    // Escape
    if (matchesKey(data, Key.escape)) {
      if (this.isSearchMode()) {
        this.exitSearchMode();
        this.invalidate();
        return;
      }
      this.done(null);
      return;
    }

    // Delegate to active panel
    if (this.activeTab === "peak") {
      this.handlePeakInput(data);
    } else {
      this.handleSessionInput(data);
    }

    this.invalidate();
  }

  // ─── Peak input ─────────────────────────────────────────────

  private handlePeakInput(data: string): void {
    if (this.peakSearchMode) {
      this.handleSearchInput(data, "peak");
      return;
    }

    if (data === "/" || data === "f") {
      this.peakSearchMode = true;
      this.peakSearchQuery = "";
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.peakSelectedIndex = Math.max(0, this.peakSelectedIndex - 1);
      this.adjustPeakScroll();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.peakSelectedIndex = Math.min(
        this.filteredAnchors.length - 1,
        this.peakSelectedIndex + 1
      );
      this.adjustPeakScroll();
      return;
    }

    if (matchesKey(data, Key.home) || data === "g") {
      this.peakSelectedIndex = 0;
      this.adjustPeakScroll();
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.peakSelectedIndex = Math.max(0, this.filteredAnchors.length - 1);
      this.adjustPeakScroll();
      return;
    }
  }

  // ─── Session input ──────────────────────────────────────────

  private handleSessionInput(data: string): void {
    if (this.sessionSearchMode) {
      this.handleSearchInput(data, "session");
      return;
    }

    if (data === "/" || data === "f") {
      this.sessionSearchMode = true;
      this.sessionSearchQuery = "";
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.sessionSelectedIndex = Math.max(0, this.sessionSelectedIndex - 1);
      this.adjustSessionScroll();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.sessionSelectedIndex = Math.min(
        this.filteredSessions.length - 1,
        this.sessionSelectedIndex + 1
      );
      this.adjustSessionScroll();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const selected = this.filteredSessions[this.sessionSelectedIndex];
      if (selected && this.sessionSwitchCallback) {
        this.sessionSwitchCallback(selected.path);
        this.done({ action: "switch", path: selected.path });
      }
      return;
    }
  }

  // ─── Search handling ────────────────────────────────────────

  private isSearchMode(): boolean {
    return (
      (this.activeTab === "peak" && this.peakSearchMode) ||
      (this.activeTab === "session" && this.sessionSearchMode)
    );
  }

  private exitSearchMode(): void {
    if (this.activeTab === "peak") {
      this.peakSearchMode = false;
    } else {
      this.sessionSearchMode = false;
    }
  }

  private handleSearchInput(data: string, panel: "peak" | "session"): void {
    if (matchesKey(data, Key.enter)) {
      if (panel === "peak") this.peakSearchMode = false;
      else this.sessionSearchMode = false;
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      if (panel === "peak") {
        this.peakSearchQuery = this.peakSearchQuery.slice(0, -1);
        this.applyPeakFilter();
      } else {
        this.sessionSearchQuery = this.sessionSearchQuery.slice(0, -1);
        this.applySessionFilter();
      }
      return;
    }

    // Printable chars
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      if (panel === "peak") {
        this.peakSearchQuery += data;
        this.applyPeakFilter();
      } else {
        this.sessionSearchQuery += data;
        this.applySessionFilter();
      }
    }
  }

  private applyPeakFilter(): void {
    this.filteredAnchors = filterAnchors(this.anchors, this.peakSearchQuery);
    this.peakSelectedIndex = 0;
    this.peakScrollOffset = 0;
  }

  private applySessionFilter(): void {
    this.filteredSessions = filterSessions(this.sessions, this.sessionSearchQuery);
    this.sessionSelectedIndex = 0;
    this.sessionScrollOffset = 0;
  }

  // ─── Scroll management ─────────────────────────────────────

  private adjustPeakScroll(): void {
    const visibleHeight = this.getListHeight();
    if (this.peakSelectedIndex < this.peakScrollOffset) {
      this.peakScrollOffset = this.peakSelectedIndex;
    } else if (this.peakSelectedIndex >= this.peakScrollOffset + visibleHeight) {
      this.peakScrollOffset = this.peakSelectedIndex - visibleHeight + 1;
    }
  }

  private adjustSessionScroll(): void {
    const visibleHeight = this.getListHeight();
    if (this.sessionSelectedIndex < this.sessionScrollOffset) {
      this.sessionScrollOffset = this.sessionSelectedIndex;
    } else if (this.sessionSelectedIndex >= this.sessionScrollOffset + visibleHeight) {
      this.sessionScrollOffset = this.sessionSelectedIndex - visibleHeight + 1;
    }
  }

  private getListHeight(): number {
    // Total height minus tab bar (1) + border (1) + search bar (1) + help (1) + border (1)
    return Math.max(5, (this.lastHeight || 24) - 5);
  }

  private lastHeight = 24;

  // ─── Rendering ──────────────────────────────────────────────

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const termHeight = (this.tui as any).height || 30;
    this.lastHeight = termHeight;

    const lines: string[] = [];
    const theme = this.theme;

    // ─ Top border
    lines.push(theme.fg("accent", "─".repeat(width)));

    // ─ Tab bar
    const tabLine = this.renderTabBar(width);
    lines.push(tabLine);

    // ─ Separator
    lines.push(theme.fg("border", "─".repeat(width)));

    // ─ Content area
    const contentHeight = termHeight - 5; // borders + tab + search + help
    const leftWidth = Math.floor(width * this.leftPaneRatio);
    const rightWidth = width - leftWidth - 1; // 1 for separator

    const leftLines = this.renderLeftPane(leftWidth, contentHeight);
    const rightLines = this.renderRightPane(rightWidth, contentHeight);

    // Merge left and right panes side by side
    const sep = theme.fg("border", "│");
    for (let i = 0; i < contentHeight; i++) {
      const left = leftLines[i] || "";
      const right = rightLines[i] || "";
      const leftPadded = padToWidth(left, leftWidth);
      const rightTruncated = truncateToWidth(right, rightWidth);
      lines.push(leftPadded + sep + rightTruncated);
    }

    // ─ Search bar / help
    if (this.isSearchMode()) {
      const query =
        this.activeTab === "peak"
          ? this.peakSearchQuery
          : this.sessionSearchQuery;
      lines.push(
        theme.fg("accent", " 🔍 ") + query + theme.fg("dim", "█")
      );
    } else {
      const helpParts = [
        "↑↓/jk navigate",
        "/ search",
        "Tab switch panel",
        "Esc close",
      ];
      if (this.activeTab === "session") {
        helpParts.splice(2, 0, "Enter switch");
      }
      lines.push(theme.fg("dim", " " + helpParts.join(" · ")));
    }

    // ─ Bottom border
    lines.push(theme.fg("accent", "─".repeat(width)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private renderTabBar(width: number): string {
    const theme = this.theme;
    const parts: string[] = [];

    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i];
      const num = `${i + 1}`;
      const isActive = tab.id === this.activeTab;

      if (isActive) {
        parts.push(
          theme.bg("selectedBg", theme.fg("accent", ` ${num}:${tab.label} `))
        );
      } else {
        parts.push(theme.fg("muted", ` ${num}:${tab.label} `));
      }
    }

    return " " + parts.join(theme.fg("border", "│"));
  }

  private renderLeftPane(width: number, height: number): string[] {
    if (this.activeTab === "peak") {
      return this.renderPeakLeft(width, height);
    } else {
      return this.renderSessionLeft(width, height);
    }
  }

  private renderRightPane(width: number, height: number): string[] {
    if (this.activeTab === "peak") {
      return this.renderPeakRight(width, height);
    } else {
      return this.renderSessionRight(width, height);
    }
  }

  // ─── Peak rendering ─────────────────────────────────────────

  private renderPeakLeft(width: number, height: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const items = this.filteredAnchors;

    if (items.length === 0) {
      lines.push(theme.fg("muted", " (no messages)"));
      while (lines.length < height) lines.push("");
      return lines;
    }

    const visible = items.slice(
      this.peakScrollOffset,
      this.peakScrollOffset + height
    );

    for (let i = 0; i < visible.length; i++) {
      const anchor = visible[i];
      const globalIdx = this.peakScrollOffset + i;
      const isSelected = globalIdx === this.peakSelectedIndex;
      const turnNum = `#${anchor.turnIndex + 1}`;
      const text = ` ${turnNum} ${anchor.preview}`;
      const truncated = truncateToWidth(text, width);

      if (isSelected) {
        lines.push(theme.bg("selectedBg", theme.fg("accent", truncated)));
      } else {
        lines.push(theme.fg("text", truncated));
      }
    }

    // Pad
    while (lines.length < height) lines.push("");

    // Scroll indicator
    if (items.length > height) {
      const indicator = `${this.peakScrollOffset + 1}-${Math.min(
        this.peakScrollOffset + height,
        items.length
      )}/${items.length}`;
      if (lines.length > 0) {
        lines[lines.length - 1] = truncateToWidth(
          theme.fg("dim", ` ${indicator}`),
          width
        );
      }
    }

    return lines;
  }

  private renderPeakRight(width: number, height: number): string[] {
    const theme = this.theme;

    if (this.filteredAnchors.length === 0) {
      return [theme.fg("muted", " Select a turn to preview")];
    }

    const anchor = this.filteredAnchors[this.peakSelectedIndex];
    if (!anchor) return [];

    const turn = this.turns[anchor.turnIndex];
    if (!turn) return [];

    const preview = formatTurnPreview(turn, width);
    const previewLines = preview.split("\n");

    // Apply basic styling
    const styled: string[] = [];
    for (const line of previewLines) {
      if (line.startsWith("┌ User")) {
        styled.push(theme.fg("accent", truncateToWidth(line, width)));
      } else if (line.startsWith("┌ Assistant")) {
        styled.push(theme.fg("success", truncateToWidth(line, width)));
      } else if (line.startsWith("┌ Tool Result")) {
        styled.push(
          theme.fg(
            line.includes("❌") ? "error" : "warning",
            truncateToWidth(line, width)
          )
        );
      } else if (line.startsWith("─")) {
        styled.push(theme.fg("border", truncateToWidth(line, width)));
      } else if (line.startsWith("  ⚡")) {
        styled.push(theme.fg("warning", truncateToWidth(line, width)));
      } else if (line.startsWith("  💭")) {
        styled.push(theme.fg("dim", truncateToWidth(line, width)));
      } else {
        styled.push(truncateToWidth(" " + line, width));
      }
    }

    // Truncate to height
    return styled.slice(0, height);
  }

  // ─── Session rendering ──────────────────────────────────────

  private renderSessionLeft(width: number, height: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const items = this.filteredSessions;

    if (items.length === 0) {
      lines.push(theme.fg("muted", " (no sessions)"));
      while (lines.length < height) lines.push("");
      return lines;
    }

    const visible = items.slice(
      this.sessionScrollOffset,
      this.sessionScrollOffset + height
    );

    for (let i = 0; i < visible.length; i++) {
      const session = visible[i];
      const globalIdx = this.sessionScrollOffset + i;
      const isSelected = globalIdx === this.sessionSelectedIndex;
      const item = formatSessionList(session);
      const text = ` ${item.label}`;
      const truncated = truncateToWidth(text, width);

      if (isSelected) {
        lines.push(theme.bg("selectedBg", theme.fg("accent", truncated)));
      } else {
        lines.push(theme.fg("text", truncated));
      }
    }

    while (lines.length < height) lines.push("");

    if (items.length > height) {
      const indicator = `${this.sessionScrollOffset + 1}-${Math.min(
        this.sessionScrollOffset + height,
        items.length
      )}/${items.length}`;
      if (lines.length > 0) {
        lines[lines.length - 1] = truncateToWidth(
          theme.fg("dim", ` ${indicator}`),
          width
        );
      }
    }

    return lines;
  }

  private renderSessionRight(width: number, height: number): string[] {
    const theme = this.theme;

    if (this.filteredSessions.length === 0) {
      return [theme.fg("muted", " Select a session to preview")];
    }

    const session = this.filteredSessions[this.sessionSelectedIndex];
    if (!session) return [];

    const preview = formatSessionPreview(session, width);

    // Apply styling
    const styled: string[] = [];
    for (const line of preview) {
      if (line.startsWith("📌") || line.startsWith("📁") || line.startsWith("💬") || line.startsWith("📅") || line.startsWith("🔗")) {
        styled.push(truncateToWidth(theme.fg("accent", " " + line), width));
      } else if (line.startsWith("─")) {
        styled.push(theme.fg("border", truncateToWidth(line, width)));
      } else if (line === "First message:") {
        styled.push(theme.fg("muted", truncateToWidth(" " + line, width)));
      } else {
        styled.push(truncateToWidth(" " + line, width));
      }
    }

    return styled.slice(0, height);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ─── Utilities ─────────────────────────────────────────────────────

function padToWidth(str: string, width: number): string {
  const visible = visibleWidth(str);
  if (visible >= width) return truncateToWidth(str, width);
  return str + " ".repeat(width - visible);
}

// ─── Extension Entry Point ─────────────────────────────────────────

export default function commander(pi: ExtensionAPI) {
  async function openCommander(
    ctx: ExtensionContext | ExtensionCommandContext,
    initialTab?: TabId
  ) {
    // Gather peak data from current session
    const entries = ctx.sessionManager.getBranch();
    const turns = extractTurns(entries as any);

    // Gather session data
    let sessions: SessionItem[] = [];
    try {
      const sessionInfos = await SessionManager.list(ctx.cwd);
      sessions = sessionInfos.map((info) => ({
        path: info.path,
        id: info.id,
        cwd: info.cwd,
        name: info.name,
        parentSessionPath: info.parentSessionPath,
        created: info.created,
        modified: info.modified,
        messageCount: info.messageCount,
        firstMessage: info.firstMessage,
        allMessagesText: info.allMessagesText,
      }));
      // Sort by modified desc
      sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
    } catch (e) {
      // Sessions might not be available
    }

    // Show the commander UI
    await ctx.ui.custom<any>((tui, theme, _kb, done) => {
      const component = new CommanderComponent(tui, theme, done, {
        turns,
        sessions,
        initialTab,
        onSessionSwitch: (path) => {
          // Will be handled after ui.custom returns
        },
      });

      return {
        render: (w: number) => component.render(w),
        invalidate: () => component.invalidate(),
        handleInput: (data: string) => {
          component.handleInput(data);
          tui.requestRender();
        },
      };
    });
  }

  // Register shortcut
  pi.registerShortcut(Key.ctrlShift("p"), {
    description: "Open Commander palette",
    handler: async (ctx) => {
      await openCommander(ctx);
    },
  });

  // Register command
  pi.registerCommand("commander", {
    description: "Open Commander palette (peak / session)",
    handler: async (args, ctx) => {
      const tab = args?.trim().toLowerCase();
      let initialTab: TabId | undefined;
      if (tab === "peak" || tab === "p") initialTab = "peak";
      else if (tab === "session" || tab === "s") initialTab = "session";
      await openCommander(ctx, initialTab);
    },
  });
}
