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

## 2.5 Branches, environments & deploy (READ BEFORE COMMITTING)

**Branch workflow — applies to every Cyber Place repo:**
- **All changes go to the `staging` branch first.** Never commit or push
  straight to the production branch.
- Production branch is **`master`** for the backend (`cyber-place`), both
  desktops (`-panel-desktop`, `-panel-desktop-agent`) and the website
  (`-panel-website`); it is **`main`** only for the mobile app
  (`CyberPlace-mob`). The staging branch is named `staging` in every repo.
- The user reviews on `staging`, then **promotes to production himself**
  (merges `staging` → the prod branch). Do not open or merge that PR
  unless explicitly asked.

**Releases / CI (this agent):** production and staging coexist in the SAME
GitHub repo, separated by **electron-updater channel + git tag**, not by
branch — so the two yml files never conflict:
- `.github/workflows/release.yml` — production; fires on tags `v*`
  (excludes `v*-staging*`); channel `latest` (`latest*.yml`).
- `.github/workflows/release-staging.yml` — staging; fires on tags
  `v*-staging*`; uses `electron-builder.staging.json` (full standalone copy),
  prerelease, channel `staging` (`staging*.yml`).
- Both workflow files live on both branches and are **tag-driven**.
  `package.json` version MUST equal the tag (incl. `-staging.N`) or the
  backend update gate loops "update available". The agent also has a
  hardcoded production backend fallback in `AgentBootstrap.ts`.

---

## 3. Stack (verified)

- **Electron 33 + Vite 5.4 + React 19** · TypeScript strict mode
- **No router** beyond a couple of screens (paired / unpaired / locked).
- **No global state library** — local React state + a small IPC bridge.
- **Auto-launch on boot:** `app.setLoginItemSettings` (`main.ts`) — which
  Electron implements on **Windows and macOS only**. `linuxIntegration.ts`
  writes a `.desktop` entry into `~/.local/share/applications`, i.e. a
  **menu entry, not an autostart entry** (`~/.config/autostart`), and there is
  no systemd unit anywhere in this repo. **On Linux the agent therefore does
  not start on boot.** Verified 2026-08-17 — do not assume otherwise.
- **Lock/unlock:** an Electron **window**, not an OS session lock. There is no
  D-Bus code, no Windows lock API, and no native module in this repo (grep for
  `child_process|exec|spawn|loginctl|dbus` returns nothing but a comment).
  `hideLockOverlay` uses opacity-0 + click-through + offscreen. Consequence:
  killing the process removes the lock, and nothing restarts it. Treat the
  overlay as a UX affordance, not an access control.
- **Bootstrap:** `/agent/hello` resolves server URL, PC ID, label, and
  emergency PIN hash from a pairing token. The pairing token is persisted to
  disk **in plaintext** (`storage.ts` → `agent.config.json`, no mode set), and
  the branch's emergency-PIN **hash is also persisted**, in renderer
  localStorage (`PinCache.ts`). The older claim that only the token touches
  disk is wrong.
- **Transport:** **REST polling every 2s** (`RestPollingTransport`).
  `WebSocketTransport.ts` exists but `TransportFactory` never returns it —
  it is dead code. There is no Reverb/Echo/Pusher dependency in
  `package.json`. IPC main↔renderer for local commands.
- **Auto-update:** `electron-updater 6.8.3`, GitHub releases provider.
  Update checks arrive as an `agent.check-updates` **command over the REST
  poll**, not over a Reverb channel — the agent subscribes to nothing.
  `verifyUpdateCodeSignature` is currently `false`, so the Authenticode
  signature CI produces is not checked at install time.
- **Code-signing:** Windows installer signed with self-signed Cyber Place
  cert. SmartScreen still warns by design.
- **Crypto on disk:** `bcryptjs` for emergency-PIN compare (hash comes
  from backend; raw PIN never lands on disk).

### Kiosk hardening (NEVER LOOSEN in production builds)
- F11 / F12 / Ctrl+R / context-menu / drag-and-drop disabled in prod.
- Chromium cache capped at 50 MB with hourly purge + boot-time clear.
- The renderer is loaded with `loadFile()`, i.e. over `file://`. There is no
  custom `app://` protocol in this repo (unlike the staff panel, which does
  register one). Earlier revisions of this doc claimed otherwise.
- **DevTools follow the BUILD, not the environment.** `isDev = !app.isPackaged`
  and `devTools: isDev`, so a packaged build never opens them. There is no
  `ELECTRON_DEVTOOLS` variable in this repo — that claim was wrong.
- **`ELECTRON_DEV_URL` is ignored in packaged builds** (`main.ts`). It used to
  be honoured, which let anyone relaunch the installed binary with it set and
  get a non-kiosk window, DevTools, and an attacker-controlled page **with the
  preload attached** — i.e. `agentAPI.unlock()` and the pairing token. Never
  let build-time posture be decided by a runtime environment variable: this
  app runs on machines customers can physically touch.
- `setWindowOpenHandler` denies outright — the kiosk has no legitimate
  external-link case — and `will-navigate` blocks any top-level navigation
  away from the bundled page, so the preload can never follow to a new origin.

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
- **No hard-coded domain string literals.** Any closed set (command
  `kind`, session state, connection status) is a TS `type` + `const` map
  + helper predicates in one module — compare against those, never bare
  `"active"` / `"locked"` scattered across files. Mirror the backend
  `App\Enums\*` naming where the set crosses the wire.
- **Production-ready only** — no `TODO: implement later` in shipped diffs.
- **API Resources / Resource wire-shape are owned by the backend** — when
  a backend contract the agent consumes changes, update the agent's type
  in the SAME change so `tsc` catches drift.
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
- **`endsAt: null` on a session UPDATE is not noise — it is a session that
  has just been given no end.** Since 2026-09-03 a cashier can switch a paid
  block to unlimited, and the backend expresses that by nulling `ends_at` and
  sending `session.update`. `onSessionUpdate` used to dismiss that case as
  "rare" and return, which left the countdown running against the OLD end: the
  agent expired the session and locked the workstation under a player whose
  session had explicitly been given no end. It now calls
  `Session.makeOpenEnded()` and drops out of `expiring` as well as out of the
  countdown. `extend()` deliberately does NOT accept null — its whole rule is
  "never bring the end forward", and null is the absence of an end rather than
  an earlier one.
- **Typecheck command:** ALWAYS run both
  `tsc -p tsconfig.app.json --noEmit` **and** `tsc -p electron/tsconfig.json --noEmit`.
  The root config silently misses `src/` errors that CI catches.
- **Confirm dialogs / number inputs:** use in-app `ConfirmDialog` and the
  `NumberStepper` text pattern; native `window.confirm()` and
  `<input type="number">` both poison renderer focus on Linux WMs.
- **DevTools:** auto-detached DevTools poison focus too. They are gated on
  `!app.isPackaged` — a build-time fact. Never gate them, or kiosk mode, on an
  environment variable: the machine's environment is attacker-controlled.

---

## 5. Realtime — what the agent listens to

**The agent has no realtime surface at all.** Verified 2026-08-17: it
subscribes to zero channels and there is no Reverb/Echo/Pusher dependency in
`package.json`. Earlier revisions of this file listed `app-updates` and
`app-updates.{role=agent}` — that was never implemented here.

Everything reaches the agent by **polling `GET /agent/poll-commands` every
2 seconds** (`RestPollingTransport`), including session start/stop, lock/unlock
and `agent.check-updates`. `WebSocketTransport.ts` exists but
`TransportFactory` never returns it; it is dead code awaiting either removal
or wiring.

Do not subscribe the agent to `branch.{id}` or `company.{id}` — those are staff
panel and mobile concerns.

Known gap, do not mistake for working behaviour: `RestPollingTransport.send()`
buffers heartbeats and **silently drops every other outbound event**, so
`agent.hello`, `agent.session.ack` and `pong` never reach the backend. The
consequence is that the server never receives `machineId`, and therefore cannot
detect two agents paired with the same token.

If the backend adds new agent commands, add them to `SessionManager`'s command
switch and the corresponding controller in the backend in the SAME change, and
document the new command here.

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
9. **"100% guaranteed" means proven, not asserted.** The user demands
   maximum rigor. Verify everything machine-verifiable and give an
   **honest verified-vs-stage split** — never a bare "yes, 100%". Name
   what could only be validated on a paired PC / real LAN and leave it
   for the user to smoke-test rather than implying it was checked.

---

## 8. Specialist roles, agents & plugins (use them — don't improvise)

Cyber Place is built to a professional standard across four disciplines:
**architecture, security, design, go-to-market.** Each has a dedicated
subagent in `~/.claude/agents/` with this product's real constraints baked
in.

| Agent | Use it for (kiosk-agent-relevant) |
|---|---|
| `cp-security-engineer` | **First stop for this repo.** The agent runs on a machine customers can physically touch: assume DevTools, local storage, and request replay are available to an attacker. It must hold no credential beyond its own pairing, and the backend must re-authorize every command server-side |
| `cp-frontend-architect` | Overlay lifecycle, socket/command handling, state, TS contracts with the backend |
| `cp-ui-designer` | The kiosk is a full-screen appliance: huge type, no chrome, no scroll, readable across the room, zero affordances to discover |
| `cp-backend-architect` | Any change to the pairing or WebSocket command contract — server first, agent mirrors |
| `cp-release-engineer` | electron-builder packaging, signing, staging-as-separate-app, `electron-updater` rollout |

**Slash commands** (`~/.claude/commands/`): `/cp-secure`, `/cp-feature`,
`/cp-ship`, `/cp-design`.

**Plugins enabled in every session:**

- **`superpowers`** — brainstorming, TDD, systematic debugging,
  verification-before-completion.
- **`frontend-design`** — invoke before writing any UI.
- **`code-review`** — `/code-review` on the branch diff before pushing.
- **`aikido`** — `aikido:scan` on changed files after non-trivial work.
- **`context7`** — current Electron docs instead of memory.

**Agent-specific defaults these roles enforce**: never `hide()` or
`minimize()` the overlay — use opacity-0 + click-through + offscreen;
graceful quit is SIGTERM + a 2–4s wait before SIGKILL (a hard kill shows
the Chromium fatal-error popup); `endsAt: null` means an open session and
must stay `Date | null` end to end; typecheck **both** tsconfigs; and
anything that can only be proven on a paired PC or a real LAN stays a
named user smoke-test, never an implied pass.

## 9. How work must be done here (MANDATORY — and read the ceiling)

1. **Baseline BEFORE touching anything.**
   ```
   npm run typecheck   # BOTH tsconfig.app.json and electron/tsconfig.json
   npm run build       # proves renderer AND main process compile
   ```

2. **Check the blast radius before editing.** All seven `/agent/*` endpoints
   live in `cyber-place`; grep it before changing any request or response
   shape. Remember the agent subscribes to **no** realtime channel — it polls
   REST, so there is no broadcast contract to keep in step here.

3. **Reuse this repo's own idiom** — never `hide()`/`minimize()` the overlay
   (opacity-0 + click-through + offscreen), `Date | null` end to end for
   `endsAt`, the on-screen keypad rather than `<input type="number">`.

4. **Re-run typecheck and build**, compare against step 1.

5. **`aikido_full_scan` every changed file.**

6. **Commit to `staging`**, stating what was verified versus only reasoned about.

**⚠️ Proof ceiling here: LOW, and it must be stated every time.** This repo has
**no test runner at all**. The honest ceiling is typecheck plus a successful
build. Never claim a change is "verified working" on the agent — the things
that actually matter here (kiosk escape, autostart, lock behaviour, a packaged
build honouring or ignoring an env var, behaviour on a real club LAN) can only
be confirmed on a paired PC. Name them as smoke-tests.

**Security posture is decided at BUILD time, never by the environment.** This
machine is physically accessible to customers, so `process.env` is
attacker-controlled input. `isDev` is `!app.isPackaged` and must stay that way.

**Known gap worth closing:** vitest over the pure modules would move the
ceiling — `Session.remainingMs`/`extend` and the `endsAt: null` semantics,
`SessionManager` command routing, `RestPollingTransport` dedupe and backoff,
`AgentConfig.normalize`. All pure, all safety-critical, all unverified today.

---

_Last verified: 2026-07-18. When the agent's stack, OS integration, or
pairing/WebSocket contract changes, update the relevant section here in
the same change._
