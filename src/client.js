import { mkdir, writeFile, rename, readFile, unlink, lstat, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'

const ROOT = join(homedir(), 'Library/Application Support/MySpaceNotifications')
const APP = join(homedir(), 'Applications/MySpace Notifications.app')
export function normalize(input) {
  if (!input || typeof input !== 'object') throw new TypeError('notification must be an object')
  const field = (name, max, fallback) => {
    const value = input[name] ?? fallback
    if (typeof value !== 'string' || value.length > max) throw new TypeError(`invalid ${name}`)
    return value
  }
  const title = field('title', 200, '')
  if (!title.trim()) throw new TypeError('title is required')
  const action = input.action ?? 'none'
  if (!['none', 'open-dsh'].includes(action)) throw new TypeError('invalid action')
  if (input.sound !== undefined && typeof input.sound !== 'boolean') throw new TypeError('invalid sound')
  return { title, body: field('body', 2000, ''), subtitle: field('subtitle', 300, ''), action, sound: input.sound === true }
}
export async function request(operation, input = {}, { root = ROOT, launch = true, timeoutMs = 10000 } = {}) {
  if (!['send', 'authorize', 'status'].includes(operation)) throw new TypeError('invalid operation')
  const payload = { operation, ...(operation === 'send' ? normalize(input) : {}) }
  if (launch && process.platform !== 'darwin') throw new Error('macOS notification bridge only')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('notification queue must be a private owned directory')
  await chmod(root, 0o700)
  if (launch) await new Promise((resolve, reject) => execFile('/usr/bin/open', ['-g', APP], error => error ? reject(error) : resolve()))
  const id = randomUUID()
  const temp = join(root, `${id}.tmp`), file = join(root, `${id}.request`), result = join(root, `${id}.response`)
  try {
    await writeFile(temp, JSON.stringify(payload), { mode: 0o600, flag: 'wx' })
    await rename(temp, file)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const value = JSON.parse(await readFile(result, 'utf8'))
        if (!value.ok) throw new Error(value.error || 'notification rejected')
        return value
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('notification helper timed out')
  } finally {
    await Promise.all([temp, file, result].map(path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })))
  }
}
export const send = input => request('send', input)
