# dsh-notification-bridge — 本地 macOS 通知桥

[English](README.md) | [中文](README.zh.md)

独立 DSH host 插件 `dsh-notification-bridge`；不修改 DSH 源码、preload、签名或内部 IPC。原生 Swift Helper 是本插件的发送后端，不是 DSH 分支。

仓库元数据：`https://github.com/fegnze/dsh-notification-bridge`。源码沿用 MySpace 根仓库的 Zlib 许可证，副本见 `LICENSE`；不分发本机 DSH 图标或签名产物。npm 白名单包含入口、客户端、原生源码、构建/CLI 脚本和中英文 README；不含本机签名 App、复制的 DSH 图标、测试或私有通知队列。

## 身份与边界

- 原生组件：`~/Applications/MySpace Notifications.app`，bundle ID `local.myspace.notifications`；菜单栏/Dock 不常驻图标。
- 使用 AppKit + UserNotifications，通知身份为 MySpace 通知，不冒用 DSH 的 bundle ID。图标构建时从本机 DSH 复制，图标二进制不入库。
- 仅本机 ad-hoc 签名；无 Apple 开发者账号、Developer ID、公证或公开分发流程。
- `accepted: true` 仅表示系统 API 接受请求，不保证勿扰状态下弹横幅。横幅、图标、点击行为需实机目测。
- 点击 `open-dsh` 唤起 `/Applications/DeepSeek Harness.app`，不承诺定位具体会话。不接受任意 URL、shell 或可执行命令作为点击动作。

## 构建、安装和授权

需要本机 Xcode Swift 编译器及 Bun：

```sh
bun run scripts/build.ts --install
bun scripts/cli.js status
bun scripts/cli.js authorize
bun scripts/cli.js send '{"title":"测试通知","body":"原生通知桥","action":"open-dsh"}'
```

权限状态为 Apple 枚举：0 未询问、1 拒绝、2 已授权、3 临时授权。拒绝时去系统设置 → 通知 → MySpace 通知开启；不绕过授权。偶见 authorize 回调报错但稍后 status 已为 2，以 status 与真实 send 结果为准。

Helper 由调用时 `open -g` 按需启动，不另装 LaunchAgent，不注册为守护服务。它以 accessory app 运行并保留通知点击处理；正常空闲时每 250ms 检查私有队列。退出可用活动监视器结束 MySpace Notifications；下一次发送会重新启动。

## DSH 接入

profile 依赖声明本地链接：

```json
"dsh-notification-bridge": "link:/absolute/path/to/MySpace/dsh-plugins/dsh-notification-bridge"
```

示例中的绝对路径需替换为实际工作区。Cordis 组件 ID 保留 `myspace-notification-bridge`，服务名 `myspaceNotifications`、配置字段、原生 bundle ID 和队列路径不变，以保留已有设置与通知权限。

把包名追加到 `dsh.profile.bundles`，运行该 profile 的依赖安装，然后重开承载该 profile 的 DSH。desktop 由 Electron 独占，不能用 `dsh plugin --profile desktop`；不重启正在承载会话的应用。

默认 `sessionEvents: true`：根会话完成、失败、停止、达到上限、被阻断、ask_user_question 等待通知；不通知子代理。同会话同类型 10 秒内去重。可在 profile patch 设置 `sessionEvents: false`，仅提供通用能力。dsh-notify 的 bundle 可停用，避免重复；其他插件自己的通知需分别检查，不自动禁用。

会话通知正文不显示会话 ID：优先读取已有会话标题（重启后也可从日志读取），其次最近用户消息摘要，最后显示「当前任务」；正文主题压缩空白并限制为 100 字符。ID 只用于内部去重。

其他 host 插件按 Cordis 服务契约声明依赖：

```js
export const inject = ['myspaceNotifications']
export function apply(ctx) {
  void ctx.myspaceNotifications.send({
    title: '我的插件 · 完成',
    body: '任务已完成',
    subtitle: '工作区 · 会话',
    action: 'open-dsh',
    sound: false,
    dedupeKey: 'my-plugin:run-123:done',
  }).catch(error => ctx.logger.warn(error.message))
}
```

服务提供 `send()` 与 `status()`。名称/字段上限及校验在 `src/client.js`；拒绝或超时会抛错，不静默退回 AppleScript。当前仅 host 接口，没有 HTTP 入口、浏览器接口或 MCP 工具。

## 非 DSH 调用与 Butler

本机 JS/Bun 程序可导入 `src/client.js` 的 `send()`，或调用 CLI。stdin 入口避免正文出现在进程 argv：

```sh
printf '%s' '{"title":"工作流完成","body":"健康扫描"}' | bun scripts/cli.js send --stdin
```

Butler 在工作目录根的 `butler.json` 配置 `notification.command` 命令数组，DSH App 内的 Butler host 负责 spawn 并将 JSON 写入 stdin，不 import 本插件、不内嵌工作区路径。配置 native transport 后，失败记录警告，不降级为脚本编辑器通知；未配置命令时由 host 使用系统通知通道。

## 私有队列与失败语义

使用当前用户的 `~/Library/Application Support/MySpaceNotifications`，目录 0700、请求/响应 0600，UUID 文件名，原子提交；不开放 TCP 端口。同用户进程是信任边界，不防御已经控制该用户的程序。客户端等待响应后清理；超时会清理未消费的请求，但请求若已被 Helper 接收，通知仍可能送达，不能保证撤回或恰好一次。Helper 清理过期队列文件，通知不会写长期正文日志。

## 测试与验收

```sh
node --test test/*.test.js
```

测试覆盖字段校验、动作白名单、私有目录拒绝、原子队列响应与清理、超时清理及插件事件适配。另需在真实 Cordis 运行时验证服务注册，在本机执行 status/send 验证原生 API。系统通知外观和点击后打开应用仍需人工确认。
