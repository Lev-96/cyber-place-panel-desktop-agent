# cyber-place-panel-desktop-agent — Working Notes for Claude

> Kiosk Electron agent installed on each gaming PC. Locks the workstation
> when idle, unlocks when a cashier starts a session from the staff panel.
> **NOT** a duplicate of the staff panel — different surface, different rules.
> Source of truth for THIS project. Cross-project context is in section 2.
> When code and this doc disagree, **trust the code first, then update this doc**.
> Last verified: 2026-05-28.

---

## 1. What this app is

A small Electron app that runs full-screen on every gaming PC. Its only
purpose is OS-level access control:

- **Lock the workstation** when there is no active session (kiosk overlay
  covers the screen, input is blocked, keyboard shortcuts neutralised).
- **Unlock** when the backend tells it a paired session has started.
- **Emergency PIN** lets staff bypass the lock if the network is down.

There is no booking UI, no payment UI, no tournament UI. Anything related
to bookings, sessions, or billing lives in the staff panel or the mobile
app — not here.

---

## 2. The Cyber Place ecosystem (read-only map for context)

| Project | Path | Role |
|---|---|---|
| `cyber-place` | `/var/www/html/cyber-place/` | Laravel 10.50 backend |
| `CyberPlace-mob` | `/var/www/html/CyberPlace-mob/` | Customer mobile app (Expo SDK 54) |
| `cyber-place-panel-desktop` | `/var/www/html/cyber-place-panel-desktop/` | Staff Electron panel |
| **`cyber-place-panel-desktop-agent`** (this one) | `/var/www/html/cyber-place-panel-desktop-agent/` | Kiosk Electron agent on each gaming PC |
| `cyber-place-panel-website` | `/var/www/html/cyber-place-panel-website/` | Public landing (static HTML) |

Cross-project rule: any change to the pairing handshake, agent WebSocket
contract, or `/agent/*` REST endpoints must be reflected in the backend
side and in the staff panel's "pair PC" UI in the SAME change.

---

## 3. Stack (verified)

- **Electron 33 + Vite 5.4 + React 19** · TypeScript strict mode
- **No router** beyond a couple of screens (paired / unpaired / locked).
- **No global state library** — local React state + a small IPC bridge.
- **Auto-launch on boot:** Linux systemd (`linuxIntegration.ts`), Windows
  `app.setLoginItemSettings`.
- **Lock/unlock:** D-Bus on Linux, native Windows API.
- **Bootstrap:** `/agent/hello` resolves server URL, PC ID, label, and
  emergency PIN hash from a pairing token. **Only the pairing token is
  persisted to disk.** Everything else is in-memory.
- **Transport:** WebSocket to backend after pairing. IPC main↔renderer for
  local commands (lock/unlock, machineId, version).
- **Auto-update:** `electron-updater 6.8.3`, GitHub releases provider, plus
  staged rollout coordinated by the backend (`app-updates` Reverb channel).
- **Code-signing:** Windows installer signed with self-signed Cyber Place
  cert. SmartScreen still warns by design.
- **Crypto on disk:** `bcryptjs` for emergency-PIN compare (hash comes
  from backend; raw PIN never lands on disk).

### Kiosk hardening (NEVER LOOSEN in production builds)
- F11 / F12 / Ctrl+R / context-menu / drag-and-drop disabled in prod.
- Chromium cache capped at 50 MB with hourly purge + boot-time clear.
- Custom `app://` protocol — no `file://` disclosure.
- DevTools hidden behind `ELECTRON_DEVTOOLS=1` env var.

### Electron security posture (NEVER LOOSEN)
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- All Node access via preload + `contextBridge`. Renderer must never
  `require`.
- Validate every IPC payload in the main process.
- No remote module, no `webPreferences` shortcuts.

---

## 4. Universal coding standards (apply here too)

- **Analyse before editing.** Read the file end-to-end, grep for usages of
  symbols being changed.
- **SOLID is non-negotiable.** Single-responsibility, composition over
  patching, small contracts, depend on abstractions.
- **KISS + DRY.** Reuse the small primitive set (Button, Modal,
  ConfirmDialog).
- **Production-ready only** — no `TODO: implement later` in shipped diffs.
- **Never expose secrets** or log tokens / PIN values / pairing tokens.
- **Communicate with the user in Russian** (casual tone). Code, commit
  messages, and PR descriptions stay in English.

### Project-specific traps (memorise)

- **Kiosk overlay technique:** NEVER use `window.hide()` or
  `window.minimize()` on the lock overlay. On Linux WMs that freezes the
  renderer. The correct pattern is **opacity-0 + click-through +
  offscreen** so the window stays alive but invisible/inert. Reverting to
  hide/minimize will silently break the unlock path.
- **Open-session contract with backend:** when a session is "play without
  a fixed duration", the backend sends `endsAt: null`. The agent stack
  must accept `Date | null` end-to-end. **Never do `new Date(maybeNull)`**
  — that produces 1970 and silently fires the expiry path.
- **Typecheck command:** ALWAYS run both
  `tsc -p tsconfig.app.json --noEmit` **and** `tsc -p electron/tsconfig.json --noEmit`.
  The root config silently misses `src/` errors that CI catches.
- **Confirm dialogs / number inputs:** use in-app `ConfirmDialog` and the
  `NumberStepper` text pattern; native `window.confirm()` and
  `<input type="number">` both poison renderer focus on Linux WMs.
- **DevTools:** auto-detached DevTools poison focus too. Keep the
  `ELECTRON_DEVTOOLS=1` gate.

---

## 5. Realtime — what the agent listens to

The agent's realtime surface is **much smaller** than the staff panel.
It subscribes to the auto-update channel only:

| Channel | Visibility | Purpose |
|---|---|---|
| `app-updates` | public | promoted-version broadcasts (`app-update.promoted`) |
| `app-updates.{role=agent}` | public | release-available for the agent role (`app-release.available`) |

Session start/stop and lock/unlock commands flow through the agent's
**dedicated WebSocket** (post-pairing), not through Reverb. Do not
subscribe the agent to `branch.{id}` or `company.{id}` — those are staff
panel and mobile concerns.

If the backend adds new agent commands, add them to the agent's WebSocket
handler and the corresponding controller in the backend in the SAME
change. Document the new command here.

---

## 6. Testing constraints

- **No CI test suite yet** beyond manual smoke. Don't claim "tests pass"
  if no tests exist for the code being touched. Write them or say so.
- **The dev laptop cannot test Wake-on-LAN.** Realtek RTL8821CE has no
  WoWLAN. Anything WoL-related is a dead end on this machine — needs a
  wired Ethernet target.

---

## 7. AI Assistant Behaviour (for me, Claude)

When working on this project:

1. **Verify before editing.** Read the file fully. Grep for symbols I'm
   about to change. State blast radius.
2. **Respect the kiosk surface.** Don't add booking-list / billing UI
   here. Those belong in the staff panel.
3. **Never weaken security posture** (sandbox, contextIsolation, kiosk
   guards).
4. **Cross-project changes** (`/agent/*` REST, agent WebSocket contract)
   must be reflected in backend + staff panel pairing UI in the SAME
   change.
5. **Never invent secrets, URLs, package versions.** If something isn't in
   the code, say so.
6. **Run typecheck before declaring done:**
   `tsc -p tsconfig.app.json --noEmit && tsc -p electron/tsconfig.json --noEmit`.
7. **Be honest about un-verified state.** If a change can only be tested
   on Windows / a paired PC / a real gaming-club LAN, say so.
8. **Communicate with the user in Russian** (casual tone); code, commit
   messages, PR descriptions in English.

---

_Last verified: 2026-05-28. When the agent's stack, OS integration, or
pairing/WebSocket contract changes, update the relevant section here in
the same change._
