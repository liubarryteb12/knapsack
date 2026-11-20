/**
 * stdio 冒烟：按 MCP 协议走 initialize → tools/list → tools/call。
 * 断言 server 能启动、四个只读工具可见、返回快照数据、无快照时返回引导文案。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'

const ENTRY = path.join(import.meta.dirname, '..', 'src', 'index.js')
const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'snapshot.example.json')

function startServer(args) {
  const child = spawn(process.execPath, [ENTRY, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  const rl = readline.createInterface({ input: child.stdout })
  const pending = new Map()
  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  let nextId = 1
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 8000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  return { child, request, notify }
}

async function handshake(server) {
  const init = await server.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'knapsack-mcp-test', version: '0.0.0' },
  })
  assert.equal(init.result?.serverInfo?.name, 'knapsack-mcp')
  server.notify('notifications/initialized', {})
}

test('stdio：四工具可见且只读', async () => {
  const server = startServer(['--snapshot', FIXTURE])
  try {
    await handshake(server)
    const list = await server.request('tools/list', {})
    const names = list.result.tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, [
      'knapsack_get_board',
      'knapsack_get_goals',
      'knapsack_get_prompts',
      'knapsack_get_roles',
    ])
    for (const tool of list.result.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} 应为只读`)
    }
  } finally {
    server.child.kill()
  }
})

test('stdio：tools/call 返回快照数据', async () => {
  const server = startServer(['--snapshot', FIXTURE])
  try {
    await handshake(server)
    const res = await server.request('tools/call', { name: 'knapsack_get_goals', arguments: {} })
    const text = res.result.content[0].text
    const payload = JSON.parse(text)
    assert.ok(Array.isArray(payload.goals))
    assert.ok(payload.goals.length >= 1)
    const board = JSON.parse(
      (await server.request('tools/call', { name: 'knapsack_get_board', arguments: {} })).result.content[0].text,
    )
    assert.ok(board.columns && Array.isArray(board.roles))
  } finally {
    server.child.kill()
  }
})

test('stdio：无快照时返回引导文案而非协议错误', async () => {
  const server = startServer(['--snapshot', path.join(import.meta.dirname, 'nope.json')])
  try {
    await handshake(server)
    const res = await server.request('tools/call', { name: 'knapsack_get_roles', arguments: {} })
    assert.equal(res.error, undefined)
    assert.match(res.result.content[0].text, /导出快照/)
  } finally {
    server.child.kill()
  }
})
