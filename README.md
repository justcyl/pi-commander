# pi-commander

A command palette extension for [pi](https://github.com/badlogic/pi-mono) coding agent.

Press `Ctrl+Shift+K` to open a centered overlay panel with two tabs:

## Panels

### 🔭 Peak — Conversation Browser
- **Left pane**: All user messages as turn anchors (numbered `#1`, `#2`, ...)
- **Right pane**: Full turn preview (user message + assistant response + tool calls/results)
- Navigate with `↑↓` / `jk`, search with `/`

### 📋 Session — Session Switcher  
- **Left pane**: All sessions for current project, sorted by last modified
- **Right pane**: Session metadata preview (cwd, message count, timestamps, first message)
- `Enter` to switch to selected session, search with `/`

## Keybindings

| Key | Action |
|-----|--------|
| `Ctrl+Shift+K` | Open Commander |
| `1` / `2` | Switch to Peak / Session tab |
| `Tab` / `Shift+Tab` | Cycle tabs |
| `↑` / `↓` / `j` / `k` | Navigate list |
| `g` / `G` | Jump to top / bottom |
| `/` or `f` | Enter search mode |
| `Enter` | Switch session (Session tab) |
| `Esc` | Exit search or close Commander |

## Installation

Copy the `commander` directory to your pi extensions:

```bash
cp -r commander ~/.pi/agent/extensions/commander
```

Or use as a command:

```bash
pi -e ./commander/src/index.ts
```

## Also available as command

```
/commander           # Open with default tab
/commander peak      # Open Peak tab
/commander session   # Open Session tab
```

## Development

```bash
npm test          # Run tests
npm run test:watch  # Watch mode
```
