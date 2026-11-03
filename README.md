# Claude Control

One Claude Code session per vault ticket, with a live status dot for each.

The sidebar lists active tickets from your vault's `Tickets/` folder, grouped like the Obsidian board. Clicking a ticket opens a real Claude Code terminal for it. Each session runs in its own tmux session on a private server, so it keeps running when you switch tickets or quit the app.

## Requirements
- macOS, Node 22+
- `claude` (Claude Code) and `tmux` on your login shell's PATH

## Setup
Point the app at your Obsidian vault in `~/.claude-control/config.json`:
```json
{ "vault": "/path/to/your/vault" }
```
The app reads tickets from `<vault>/Tickets/*.md` and column order from `<vault>/board.base`, and runs every session with the vault as its working directory. Restart the app after changing it.

## Run
```sh
npm install
npm run dev      # development, with hot reload
npm run build && npm start
npm test
```

## Dots
| Dot | Meaning |
|---|---|
| 🟡 | Thinking: working on a prompt or running tools |
| 🟠 | Needs you: permission prompt, a question, or a plan to approve |
| 🔴 | Error or blocker: API error, or the session failed to start |
| 🔵 | Finished while you were on another ticket |
| 🟢 | Idle |
| ⚪ | No session running (clicking resumes the saved conversation) |

## How it works
- **Sessions:** `tmux -L claude-control` with its own config (`~/.claude-control/control.tmux.conf`). It has no prefix key, so every key goes to Claude. Your `~/.tmux.conf` is never loaded there.
- **Status:** Claude Code hooks, passed only to these sessions with `claude --settings ~/.claude-control/control-hooks.json`. They write `~/.claude-control/status/<ticket>.json`. Normal `claude` sessions are unaffected.
- **Ticket fields:** the app only ever writes `cc_id` (a permanent ID, so renames keep their session) and `session_id` (for `claude --resume`). It never changes `updated:` or `status:`.
- **Renames:** the session follows the ticket, and Claude gets a one-time note with the new path on your next message.

## From a normal terminal
Right-click a ticket for:
- **Copy resume command:** `cd <vault> && claude --resume <id>`
- **Copy tmux attach command:** `tmux -L claude-control attach -t '=cc-<ticket>'`. There's no prefix key to detach; close the tab instead, and the session keeps running.

## Files
`~/.claude-control/`: `status/`, `pending/` (rename notices), `ids.json`, `seen.json`, `hook/status.mjs`, `control-hooks.json`, `control.tmux.conf`, and `config.json` (your vault path, see Setup).
