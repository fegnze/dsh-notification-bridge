import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile, unlink, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalize, request } from '../src/client.js'

test('normalization and bounded allowlisted actions', () => {
  assert.equal(normalize({ title: '完成' }).action, 'none')
  for (const input of [{}, { title: 1 }, { title: 'x', body: 'x'.repeat(2001) }, { title: 'x', action: 'https://evil.example' }, { title: 'x', sound: 'yes' }]) {
    assert.throws(() => normalize(input))
  }
})
test('atomic request and helper response, cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'myspace-notify-test-'))
  let timer
  try {
    timer = setInterval(async () => {
      for (const name of await readdir(root)) {
        if (!name.endsWith('.request')) continue
        const payload = JSON.parse(await readFile(join(root, name), 'utf8'))
        assert.equal(payload.operation, 'send')
        await unlink(join(root, name))
        await writeFile(join(root, name.replace('.request', '.response')), JSON.stringify({ ok: true, accepted: true }))
      }
    }, 20)
    assert.equal((await request('send', { title: 'test' }, { root, launch: false })).accepted, true)
    clearInterval(timer)
    assert.deepEqual(await readdir(root), [])
  } finally { clearInterval(timer); await rm(root, { recursive: true, force: true }) }
})
test('refuses a symlink queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'myspace-notify-test-'))
  try {
    await symlink(root, join(root, 'link'))
    await assert.rejects(request('status', {}, { root: join(root, 'link'), launch: false }), /private owned directory/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('missing helper times out without retaining private content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'myspace-notify-test-'))
  try {
    await assert.rejects(request('status', {}, { root, launch: false, timeoutMs: 30 }), /timed out/)
    assert.deepEqual(await readdir(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})
