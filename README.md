# dsh-notification-bridge — Local macOS notification bridge

[English](README.md) | [中文](README.zh.md)

An independent DSH host plugin, `dsh-notification-bridge`, that does not modify DSH source, preload, signatures, or internal IPC. Its native Swift Helper is the plugin's delivery backend, not a DSH fork.

Repository metadata: `https://github.com/fegnze/dsh-notification-bridge`. The source retains the MySpace root repository's Zlib license; see `LICENSE` for a copy. Local DSH icons and signed artifacts are not distributed. The npm allowlist includes the entry point, client, native source, build/CLI scripts, and English/Chinese READMEs; it excludes locally signed apps, copied DSH icons, tests, and private notification queues.

## Identity and boundaries

- Native component: `~/Applications/MySpace Notifications.app`, bundle ID `local.myspace.notifications`; no persistent menu-bar or Dock icon.
- Uses AppKit + UserNotifications under the MySpace Notifications identity, without impersonating DSH's bundle ID. The build copies the icon from the local DSH installation; the icon binary is not checked in.
- Local ad-hoc signing only: no Apple developer account, Developer ID, notarization, or public distribution process.
- `accepted: true` only means the system API accepted the request; it does not guarantee a banner while Do Not Disturb is active. Banners, icons, and click behavior require visual inspection on a real machine.
- Clicking `open-dsh` opens `/Applications/DeepSeek Harness.app`; it does not promise to navigate to a specific session. Arbitrary URLs, shell commands, and executables are not accepted as click actions.

## Build, install, and authorize

Requires the local Xcode Swift compiler and Bun:

```sh
bun run scripts/build.ts --install
bun scripts/cli.js status
bun scripts/cli.js authorize
bun scripts/cli.js send '{"title":"Test notification","body":"Native notification bridge","action":"open-dsh"}'
```

Authorization status uses Apple's enum: 0 not determined, 1 denied, 2 authorized, 3 provisional. If denied, enable it in System Settings → Notifications → MySpace Notifications; authorization is never bypassed. Occasionally the authorize callback reports an error while a later status is already 2; use status and an actual send result as the evidence.

The Helper starts on demand through `open -g`, without installing a LaunchAgent or registering a daemon. It runs as an accessory app and keeps notification-click handling available; while normally idle, it checks the private queue every 250 ms. Quit MySpace Notifications through Activity Monitor to stop it; the next send starts it again.

## DSH integration

Declare a local link in the profile's dependencies:

```json
"dsh-notification-bridge": "link:/absolute/path/to/MySpace/dsh-plugins/dsh-notification-bridge"
```

Replace the example absolute path with your actual workspace. The Cordis component ID remains `myspace-notification-bridge`; the service name `myspaceNotifications`, configuration fields, native bundle ID, and queue path remain unchanged to preserve existing settings and notification permissions.

Append the package name to `dsh.profile.bundles`, install dependencies for that profile, then reopen the DSH instance hosting it. Electron exclusively owns the desktop profile, so do not use `dsh plugin --profile desktop`; do not restart the application while it is hosting an active session.

`sessionEvents: true` is the default: it notifies for root-session completion, failure, stop, limits reached, blocking, and waiting on ask_user_question; subagents do not generate notifications. Events of the same type in the same session are deduplicated within 10 seconds. Set `sessionEvents: false` in the profile patch to expose only the general-purpose capability. You can disable the dsh-notify bundle to avoid duplicates; notifications from other plugins must be checked separately and are not disabled automatically.

Session notification bodies do not show session IDs. They prefer the existing session title (also readable from logs after a restart), then a summary of the latest user message, then “当前任务” (“Current task”). Whitespace in the subject is collapsed and the subject is limited to 100 characters. IDs are used only for internal deduplication.

Other host plugins declare their dependency through the Cordis service contract:

```js
export const inject = ['myspaceNotifications']
export function apply(ctx) {
  void ctx.myspaceNotifications.send({
    title: 'My plugin · Done',
    body: 'Task completed',
    subtitle: 'Workspace · Session',
    action: 'open-dsh',
    sound: false,
    dedupeKey: 'my-plugin:run-123:done',
  }).catch(error => ctx.logger.warn(error.message))
}
```

The service provides `send()` and `status()`. Name/field limits and validation are in `src/client.js`. Rejection and timeout throw errors; there is no silent AppleScript fallback. Currently this is a host-only interface, with no HTTP endpoint, browser interface, or MCP tool.

## Non-DSH callers and Butler

Local JS/Bun programs can import `send()` from `src/client.js` or use the CLI. The stdin entry point keeps notification text out of process argv:

```sh
printf '%s' '{"title":"Workflow complete","body":"Health scan"}' | bun scripts/cli.js send --stdin
```

Butler configures the `notification.command` argument array in `butler.json` at its working-directory root. The Butler host inside the DSH App spawns the command and writes JSON to stdin; it neither imports this plugin nor embeds workspace paths. With native transport configured, failures produce warnings rather than falling back to Script Editor notifications. Without a configured command, the host uses the system notification channel.

## Private queue and failure semantics

Uses the current user's `~/Library/Application Support/MySpaceNotifications`: directory mode 0700, request/response mode 0600, UUID filenames, and atomic submission; no TCP port is opened. Same-user processes are the trust boundary; this does not defend against programs already controlling that user. The client cleans up after waiting for a response. A timeout removes unconsumed requests, but a notification may still arrive if the Helper already accepted the request; neither recall nor exactly-once delivery is guaranteed. The Helper removes expired queue files, and notification bodies are not written to long-term logs.

## Tests and acceptance

```sh
node --test test/*.test.js
```

Tests cover field validation, the action allowlist, rejection of unsafe private directories, atomic queue responses and cleanup, timeout cleanup, and plugin event adaptation. Separately verify service registration in a real Cordis runtime and run status/send locally to verify the native API. Notification appearance and opening the app on click still require manual confirmation.
