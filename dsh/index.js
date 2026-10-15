import { send, request } from '../src/client.js'
export const name = 'dsh-notification-bridge'
export const inject = []
const summary = text => typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
const readableTitle = (text, id) => {
  const value = summary(text)
  if (!value || (id && value.includes(id)) || /session-[a-z0-9-]+/i.test(value) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)) return ''
  return value
}
export function notificationSubject(session, state) {
  // Read existing titles too: restarting the plugin does not replay title events.
  const events = Array.isArray(session?.events) ? session.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'session/title') {
      const title = readableTitle(events[i].data?.title, session?.id)
      if (title) return title
    }
  }
  if (readableTitle(state.title, session?.id)) return readableTitle(state.title, session?.id)
  if (summary(state.prompt)) return summary(state.prompt)
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type !== 'user/message') continue
    const text = events[i].data?.message?.content?.find(block => block.type === 'text' && summary(block.text))?.text
    if (summary(text)) return summary(text)
  }
  return '当前任务'
}
export function createPlugin(sendNotification = send) {
return function apply(ctx, config = {}) {
  const recent = new Map()
  const service = {
    async send(input) {
      const key = input.dedupeKey
      if (key !== undefined && (typeof key !== 'string' || key.length > 300)) throw new TypeError('invalid dedupeKey')
      const now = Date.now()
      if (key && now - (recent.get(key) ?? 0) < 10000) return { ok: true, skipped: 'deduplicated' }
      if (key) recent.set(key, now)
      if (recent.size > 256) recent.delete(recent.keys().next().value)
      try { return await sendNotification(input) } catch (error) { if (key) recent.delete(key); throw error }
    },
    status: () => request('status'),
  }
  ctx.provide('myspaceNotifications', service)
  if (config.sessionEvents === false) return
  const states = new Map()
  const root = session => (session?.header?.delegationDepth ?? 0) === 0
  const stateFor = id => {
    if (!states.has(id)) states.set(id, { active: false, reason: null, title: '' })
    return states.get(id)
  }
  const emit = (session, state, kind) => {
    const titles = { finished: '任务完成', error: '任务失败', aborted: '任务停止', waiting: '等待你的选择', blocked: '回合被阻断', 'max-tokens': '达到输出上限' }
    service.send({ title: `DSH · ${titles[kind] ?? '任务结束'}`, body: notificationSubject(session, state), subtitle: 'DeepSeek Harness', action: 'open-dsh', sound: kind === 'error' || kind === 'waiting', dedupeKey: `${session.id}:${kind}` })
      .catch(error => ctx.logger.warn(`notification bridge: ${error.message}`))
  }
  ctx.on('session/event', (session, event) => {
    if (!root(session)) return
    const state = stateFor(session.id)
    if (event.type === 'session/title' && typeof event.data?.title === 'string') state.title = event.data.title.slice(0, 2000)
    if (event.type === 'user/message') state.prompt = summary(event.data?.message?.content?.find(block => block.type === 'text')?.text)
    if (event.type === 'turn/start') { state.active = true; state.reason = null }
    if (event.type === 'turn/end') state.reason = event.data?.reason?.kind ?? 'finished'
    if (event.type === 'tool/call' && event.data?.name === 'ask_user_question') emit(session, state, 'waiting')
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (!root(agent.session)) return
    const state = stateFor(agent.id)
    if (status === 'running') { state.running = true; return }
    if (!state.running) return
    state.running = false
    if (state.active) { state.active = false; emit(agent.session ?? { id: agent.id }, state, state.reason ?? 'finished') }
  })
  ctx.on('agent/disposed', ({ agent }) => states.delete(agent.id))
  ctx.effect(() => () => { states.clear(); recent.clear() })
}
}
export const apply = createPlugin()
