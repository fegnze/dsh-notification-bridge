import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, createPlugin, notificationSubject, name } from '../dsh/index.js'
import { readFileSync } from 'node:fs'

test('renamed package preserves component identity and config', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(pkg.name, 'dsh-notification-bridge')
  assert.equal(name, pkg.name)
  assert.equal(pkg.private, undefined)
  assert.match(patch, /id: myspace-notification-bridge/)
  assert.match(patch, /name: dsh-notification-bridge/)
  assert.match(patch, /sessionEvents: true/)
})

test('notification subject never displays session IDs, including after restart', () => {
  const session = { id: 'session-long-uuid', events: [{ type: 'session/title', data: { title: '修复通知主题' } }] }
  assert.equal(notificationSubject(session, {}), '修复通知主题')
  assert.equal(notificationSubject({ id: session.id }, { prompt: '最近的请求' }), '最近的请求')
  assert.equal(notificationSubject({ id: session.id }, {}), '当前任务')
  assert.equal(notificationSubject({}, { title: 'x'.repeat(200) }).length, 100)
  const id = 'session-1510efbd-f394-4234-adff-c228f6e854d5'
  const placeholder = { id, events: [{ type: 'session/title', data: { title: `会话 ${id}` } }] }
  assert.equal(notificationSubject(placeholder, { title: `会话 ${id}`, prompt: '修复通知可读性' }), '修复通知可读性')
  assert.equal(notificationSubject(placeholder, { title: `会话 ${id}` }), '当前任务')
})
test('provides independent service with session adapter disabled', () => {
  let supplied
  apply({ provide(name, service) { supplied = { name, service } } }, { sessionEvents: false })
  assert.equal(supplied.name, 'myspaceNotifications')
  assert.equal(typeof supplied.service.send, 'function')
  assert.equal(typeof supplied.service.status, 'function')
})
test('root session adapter waits for idle and filters delegated turns', async () => {
  const events = {}, sent = []
  const ctx = { provide() {}, on(name, cb) { events[name] = cb }, effect() {}, logger: { warn() {} } }
  createPlugin(async input => { sent.push(input); return { ok: true } })(ctx)
  // Real event transitions with an injected native transport.
  assert.deepEqual(Object.keys(events), ['session/event', 'agent/status', 'agent/disposed'])
  const child = { id: 'child', header: { delegationDepth: 1 } }
  events['session/event'](child, { type: 'turn/start' })
  events['agent/status']({ agent: { id: 'child', session: child }, status: 'idle' })
  assert.equal(sent.length, 0)
  const session = { id: 'root', header: { delegationDepth: 0 } }
  const agent = { id: 'root', session }
  events['session/event'](session, { type: 'session/title', data: { title: '健康扫描' } })
  events['agent/status']({ agent, status: 'running' })
  events['session/event'](session, { type: 'turn/start' })
  events['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'error' } } })
  assert.equal(sent.length, 0)
  events['agent/status']({ agent, status: 'idle' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].title, 'DSH · 任务失败')
  assert.equal(sent[0].body, '健康扫描')
  events['agent/status']({ agent, status: 'idle' })
  assert.equal(sent.length, 1)
})
