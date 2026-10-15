import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
const root = resolve(import.meta.dir, '..')
const app = join(root, 'build/MySpace Notifications.app')
const contents = join(app, 'Contents')
await mkdir(join(contents, 'MacOS'), { recursive: true })
await mkdir(join(contents, 'Resources'), { recursive: true })
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`command failed: ${args[0]}`)
}
await run(['/usr/bin/xcrun', 'swiftc', '-O', join(root, 'native/NotificationApp.swift'), '-o', join(contents, 'MacOS/notifications'), '-framework', 'AppKit', '-framework', 'UserNotifications'])
await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.myspace.notifications</string>
<key>CFBundleName</key><string>MySpace Notifications</string>
<key>CFBundleDisplayName</key><string>MySpace 通知</string>
<key>CFBundleExecutable</key><string>notifications</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSUIElement</key><true/>
<key>CFBundleIconFile</key><string>AppIcon</string>
</dict></plist>`)
// Local DSH-style icon, copied from the installed app; not distributed in source.
await copyFile('/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns', join(contents, 'Resources/AppIcon.icns'))
// Ad-hoc local signing, not Developer ID signing or public distribution.
await run(['/usr/bin/codesign', '--force', '--sign', '-', app])
if (process.argv.includes('--install')) {
  const target = join(homedir(), 'Applications/MySpace Notifications.app')
  await mkdir(join(homedir(), 'Applications'), { recursive: true })
  await run(['/usr/bin/ditto', app, target])
  console.log(`Installed ${target}`)
} else console.log(`Built ${app}`)
