/**
 * Commander Extension for pi
 *
 * Ctrl+Shift+K opens an overlay command palette with two panels:
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
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
  Key,
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

// ─── Render helpers (pi-subagents pattern) ────────────────────────────

/** Pad string to exactly `len` visible width. */
function pad(s: string, len: number): string {
  const vis = visibleWidth(s);
  if (vis >= len) return truncateToWidth(s, len, "");
  return s + " ".repeat(len - vis);
}

/** Wrap content in │ side borders, padded to fill innerW. */
function row(content: string, width: number, theme: Theme): string {
  const innerW = width - 2;
  return theme.fg("border", "│") + pad(content, innerW) + theme.fg("border", "│");
}

/** Top border: ╭── title ──╮ */
function renderHeader(text: string, width: number, theme: Theme): string {
  const innerW = width - 2;
  const padLen = Math.max(0, innerW - visibleWidth(text));
  const padLeft = Math.floor(padLen / 2);
  const padRight = padLen - padLeft;
  return (
    theme.fg("border", "╭" + "─".repeat(padLeft)) +
    theme.fg("accent", text) +
    theme.fg("border", "─".repeat(padRight) + "╮")
  );
}

/** Bottom border: ╰── text ──╯ */
function renderFooter(text: string, width: number, theme: Theme): string {
  const innerW = width - 2;
  const padLen = Math.max(0, innerW - visibleWidth(text));
  const padLeft = Math.floor(padLen / 2);
  const padRight = padLen - padLeft;
  return (
    theme.fg("border", "╰" + "─".repeat(padLeft)) +
    theme.fg("dim", text) +
    theme.fg("border", "─".repeat(padRight) + "╯")
  );
}

/** Separator: ├────────┤ */
function renderSeparator(width: number, theme: Theme): string {
  const innerW = width - 2;
  return theme.fg("border", "├" + "─".repeat(innerW) + "┤");
}

// ─── Main Commander Component ────────────────────────────────────────

const OVERLAY_WIDTH = "90%";
const OVERLAY_MIN_WIDTH = 80;
const CONTENT_HEIGHT = 20;

class CommanderComponent implements Component {
  private tui: TUI;
  private theme: Theme;
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
  private filteredSessions: SessionItem[] = [];
  private sessionSelectedIndex = 0;
  private sessionScrollOffset = 0;
  private sessionSearchMode = false;
  private sessionSearchQuery = "";

  // Preview scroll (right pane paging)
  private previewScrollOffset = 0;

  // Layout
  private leftPaneRatio = 0.35;

  constructor(
    tui: TUI,
    theme: Theme,
    done: (result: any) => void,
    options: {
      turns: Turn[];
      sessions: SessionItem[];
      initialTab?: TabId;
    }
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.activeTab = options.initialTab || "peak";
    // Init peak data
    this.turns = options.turns;
    this.anchors = extractAnchors(this.turns);
    this.filteredAnchors = this.anchors;

    // Init session data
    this.sessions = options.sessions;
    this.filteredSessions = [...this.sessions];
  }

  handleInput(data: string): void {
    // Tab switching: 1/2 or Tab/Shift+Tab
    if (!this.isSearchMode()) {
      if (data === "1") {
        this.activeTab = "peak";
        this.previewScrollOffset = 0;
        this.invalidate();
        return;
      }
      if (data === "2") {
        this.activeTab = "session";
        this.previewScrollOffset = 0;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        this.activeTab = this.activeTab === "peak" ? "session" : "peak";
        this.previewScrollOffset = 0;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.shift("tab"))) {
        this.activeTab = this.activeTab === "peak" ? "session" : "peak";
        this.previewScrollOffset = 0;
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
      this.previewScrollOffset = 0;
      this.adjustPeakScroll();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.peakSelectedIndex = Math.min(
        this.filteredAnchors.length - 1,
        this.peakSelectedIndex + 1
      );
      this.previewScrollOffset = 0;
      this.adjustPeakScroll();
      return;
    }

    if (matchesKey(data, Key.home) || data === "g") {
      this.peakSelectedIndex = 0;
      this.previewScrollOffset = 0;
      this.adjustPeakScroll();
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.peakSelectedIndex = Math.max(0, this.filteredAnchors.length - 1);
      this.previewScrollOffset = 0;
      this.adjustPeakScroll();
      return;
    }

    // Preview paging: left/right or h/l
    if (matchesKey(data, Key.left) || data === "h") {
      this.previewScrollOffset = Math.max(0, this.previewScrollOffset - CONTENT_HEIGHT);
      return;
    }
    if (matchesKey(data, Key.right) || data === "l") {
      this.previewScrollOffset += CONTENT_HEIGHT;
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
      this.previewScrollOffset = 0;
      this.adjustSessionScroll();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.sessionSelectedIndex = Math.min(
        this.filteredSessions.length - 1,
        this.sessionSelectedIndex + 1
      );
      this.previewScrollOffset = 0;
      this.adjustSessionScroll();
      return;
    }

    // Preview paging: left/right or h/l
    if (matchesKey(data, Key.left) || data === "h") {
      this.previewScrollOffset = Math.max(0, this.previewScrollOffset - CONTENT_HEIGHT);
      return;
    }
    if (matchesKey(data, Key.right) || data === "l") {
      this.previewScrollOffset += CONTENT_HEIGHT;
      return;
    }
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
    this.previewScrollOffset = 0;
  }

  private applySessionFilter(): void {
    this.filteredSessions = filterSessions(this.sessions, this.sessionSearchQuery);
    this.sessionSelectedIndex = 0;
    this.sessionScrollOffset = 0;
    this.previewScrollOffset = 0;
  }

  // ─── Scroll management ─────────────────────────────────────

  private adjustPeakScroll(): void {
    if (this.peakSelectedIndex < this.peakScrollOffset) {
      this.peakScrollOffset = this.peakSelectedIndex;
    } else if (this.peakSelectedIndex >= this.peakScrollOffset + CONTENT_HEIGHT) {
      this.peakScrollOffset = this.peakSelectedIndex - CONTENT_HEIGHT + 1;
    }
  }

  private adjustSessionScroll(): void {
    if (this.sessionSelectedIndex < this.sessionScrollOffset) {
      this.sessionScrollOffset = this.sessionSelectedIndex;
    } else if (this.sessionSelectedIndex >= this.sessionScrollOffset + CONTENT_HEIGHT) {
      this.sessionScrollOffset = this.sessionSelectedIndex - CONTENT_HEIGHT + 1;
    }
  }

  // ─── Rendering ──────────────────────────────────────────────

  render(width: number): string[] {
    const w = width; // overlay framework already constrains to OVERLAY_WIDTH

    if (this.cachedLines && this.cachedWidth === w) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const theme = this.theme;
    const innerW = w - 2; // inside │ ... │

    // ─ Header: ╭── Commander ──╮
    lines.push(renderHeader(" Commander ", w, theme));

    // ─ Tab bar
    lines.push(row(this.renderTabBar(), w, theme));

    // ─ Separator: ├──────┤
    lines.push(renderSeparator(w, theme));

    // ─ Content: two-pane via row()
    const leftWidth = Math.floor(innerW * this.leftPaneRatio);
    const rightWidth = innerW - leftWidth - 1; // 1 for middle │

    const leftLines = this.renderLeftPane(leftWidth, CONTENT_HEIGHT);
    const rightLines = this.renderRightPane(rightWidth, CONTENT_HEIGHT);

    const midSep = theme.fg("border", "│");
    for (let i = 0; i < CONTENT_HEIGHT; i++) {
      const left = pad(leftLines[i] || "", leftWidth);
      const right = pad(rightLines[i] || "", rightWidth);
      // Compose the inner content, then wrap with row()
      // row() adds │...│ and pads to w, but we need to build innerW content first
      const inner = left + midSep + right;
      lines.push(theme.fg("border", "│") + inner + theme.fg("border", "│"));
    }

    // ─ Search bar / help
    if (this.isSearchMode()) {
      const query =
        this.activeTab === "peak"
          ? this.peakSearchQuery
          : this.sessionSearchQuery;
      lines.push(row(theme.fg("accent", " 🔍 ") + query + theme.fg("dim", "█"), w, theme));
    } else {
      const helpParts = [
        "↑↓ navigate",
        "←→ page preview",
        "/ search",
        "Tab switch",
        "Esc close",
      ];
      lines.push(row(theme.fg("dim", " " + helpParts.join(" · ")), w, theme));
    }

    // ─ Footer: ╰──────╯
    lines.push(renderFooter(
      this.activeTab === "peak"
        ? " Peak: conversation turns "
        : " Session: switch sessions ",
      w, theme
    ));

    this.cachedWidth = w;
    this.cachedLines = lines;
    return lines;
  }

  private renderTabBar(): string {
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

      if (isSelected) {
        lines.push(theme.bg("selectedBg", theme.fg("accent", pad(text, width))));
      } else {
        lines.push(theme.fg("text", truncateToWidth(text, width)));
      }
    }

    while (lines.length < height) lines.push("");

    if (items.length > height) {
      const indicator = `${this.peakScrollOffset + 1}-${Math.min(
        this.peakScrollOffset + height,
        items.length
      )}/${items.length}`;
      lines[lines.length - 1] = theme.fg("dim", pad(` ${indicator}`, width));
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

    const styled: string[] = [];
    for (const line of previewLines) {
      if (line.startsWith("[U] ")) {
        styled.push(theme.fg("accent", truncateToWidth(" " + line.slice(4), width)));
      } else if (line.startsWith("[A] ")) {
        styled.push(truncateToWidth(" " + line.slice(4), width));
      } else {
        styled.push(truncateToWidth(" " + line, width));
      }
    }

    // Apply preview scroll offset and clamp
    const maxOffset = Math.max(0, styled.length - height);
    if (this.previewScrollOffset > maxOffset) this.previewScrollOffset = maxOffset;
    return styled.slice(this.previewScrollOffset, this.previewScrollOffset + height);
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

      if (isSelected) {
        lines.push(theme.bg("selectedBg", theme.fg("accent", pad(text, width))));
      } else {
        lines.push(theme.fg("text", truncateToWidth(text, width)));
      }
    }

    while (lines.length < height) lines.push("");

    if (items.length > height) {
      const indicator = `${this.sessionScrollOffset + 1}-${Math.min(
        this.sessionScrollOffset + height,
        items.length
      )}/${items.length}`;
      lines[lines.length - 1] = theme.fg("dim", pad(` ${indicator}`, width));
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

    const styled: string[] = [];
    for (const line of preview) {
      if (line.startsWith("─")) {
        styled.push(theme.fg("border", truncateToWidth(line, width)));
      } else if (line.startsWith("[meta] ")) {
        styled.push(theme.fg("dim", truncateToWidth(" " + line.slice(7), width)));
      } else {
        styled.push(theme.fg("text", truncateToWidth(" " + line, width)));
      }
    }

    // Apply preview scroll offset and clamp
    const maxOffset = Math.max(0, styled.length - height);
    if (this.previewScrollOffset > maxOffset) this.previewScrollOffset = maxOffset;
    return styled.slice(this.previewScrollOffset, this.previewScrollOffset + height);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
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

    // Show the commander UI as overlay
    await ctx.ui.custom<any>(
      (tui, theme, _kb, done) => new CommanderComponent(tui, theme as Theme, done, {
        turns,
        sessions,
        initialTab,
      }),
      { overlay: true, overlayOptions: { anchor: "center", width: OVERLAY_WIDTH, minWidth: OVERLAY_MIN_WIDTH, maxHeight: "90%" } },
    );
  }

  // Register shortcut
  pi.registerShortcut(Key.ctrlShift("k"), {
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
