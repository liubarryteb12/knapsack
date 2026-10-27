/**
 * P2 身份与加密测试：ECDH 会话密钥、AAD 绑定、逐成员凭证、加入/审批/恢复配对。
 *
 * 运行：npx tsx scripts/test-team-identity.ts
 * 覆盖 PLAN：A14（AAD/篡改不处理）、A15（越权/凭证）、A16（跨会话拒绝）、A20（密码互操作/重绑定）、A21（首次加入与恢复配对）。
 */
import 'fake-indexeddb/auto'
import {
  generateEcdhKeyPair,
  importEcdhPublicKey,
  deriveSessionKey,
  sealWithAad,
  openWithAad,
  buildAad,
  generateCredentialSecret,
  issueCredential,
  verifyCredential,
  buildHostTicket,
  parseHostTicket,
  bytesToBase64,
  toB64u,
  utf8,
} from '../src/mods/mod-team/domain/identity'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

async function expectThrow(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    check(name, false)
  } catch {
    check(name, true)
  }
}

// ---------- ECDH 会话密钥 ----------

async function testEcdh() {
  console.log('ECDH 会话密钥')
  const host = await generateEcdhKeyPair()
  const client = await generateEcdhKeyPair()
  const sessionId = 'sess-1'

  const hostPub = await importEcdhPublicKey(host.publicKeyB64u)
  const clientPub = await importEcdhPublicKey(client.publicKeyB64u)

  const hostKey = await deriveSessionKey(host.privateKey, clientPub, sessionId, 'host<-client')
  const clientKey = await deriveSessionKey(client.privateKey, hostPub, sessionId, 'host<-client')

  // 双向派生一致：host 加密，client 能解
  const msg = utf8('hello-team')
  const sealed = await sealWithAad(hostKey, msg, 'aad-1')
  const opened = await openWithAad(clientKey, sealed, 'aad-1')
  check('双向派生密钥一致（host 加密 client 解）', new TextDecoder().decode(opened) === 'hello-team')

  // 不同会话号派生不同密钥
  const hostKey2 = await deriveSessionKey(host.privateKey, clientPub, 'sess-2', 'host<-client')
  await expectThrow('会话号不同→密钥不同，解密失败', () => openWithAad(hostKey2, sealed, 'aad-1'))

  // 第三方密钥无法解密
  const other = await generateEcdhKeyPair()
  const otherKey = await deriveSessionKey(other.privateKey, hostPub, sessionId, 'host<-client')
  await expectThrow('第三方成员密钥无法解密（成员间隔离）', () => openWithAad(otherKey, sealed, 'aad-1'))
}

// ---------- AAD 绑定（A14/A16） ----------

async function testAad() {
  console.log('AAD 绑定与篡改')
  const host = await generateEcdhKeyPair()
  const client = await generateEcdhKeyPair()
  const hostPub = await importEcdhPublicKey(host.publicKeyB64u)
  const clientPub = await importEcdhPublicKey(client.publicKeyB64u)
  const key = await deriveSessionKey(host.privateKey, clientPub, 's', 'host<-client')

  const aad = buildAad('s', 'POST', '/action')
  const sealed = await sealWithAad(key, utf8('payload'), aad)

  check('正确 AAD 可解密', new TextDecoder().decode(await openWithAad(key, sealed, aad)) === 'payload')
  await expectThrow('错误 AAD 解密失败（跨路径/跨会话拒绝）', () =>
    openWithAad(key, sealed, buildAad('s', 'POST', '/other')),
  )
  await expectThrow('换会话号的 AAD 失败', () => openWithAad(key, sealed, buildAad('s2', 'POST', '/action')))

  // 篡改密文
  const tampered = sealed.slice()
  tampered[tampered.length - 1] ^= 0x01
  await expectThrow('密文篡改解密失败', () => openWithAad(key, tampered, aad))

  // 错密钥
  const wrong = await deriveSessionKey(client.privateKey, hostPub, 'other', 'host<-client')
  await expectThrow('错密钥解密失败', () => openWithAad(wrong, sealed, aad))

  // 截断
  await expectThrow('截断报文拒绝', () => openWithAad(key, sealed.subarray(0, 10), aad))

  // 协议信封：请求使用基础 AAD，响应使用绑定 type/operationId 的完整 AAD。
  const responseAad = buildAad('s', 'POST', '/action', {
    type: 'submission.submit',
    operationId: 'op-1',
  })
  const responseSealed = await sealWithAad(key, utf8('response'), responseAad)
  check(
    '请求基础 AAD 与响应完整 AAD 可独立往返',
    new TextDecoder().decode(await openWithAad(key, responseSealed, responseAad)) === 'response',
  )
  await expectThrow('响应完整 AAD 不能用于解请求体', () =>
    openWithAad(key, sealed, responseAad),
  )
}

async function testSendActionWire() {
  console.log('客户端真实报文 AAD')
  const { sendAction } = await import('../src/mods/mod-team/domain/teamClient')
  const host = await generateEcdhKeyPair()
  const client = await generateEcdhKeyPair()
  const sessionId = 'wire-session'
  const ticket = parseHostTicket(
    buildHostTicket({
      ip: '192.168.1.8',
      port: 41234,
      sessionId,
      teamId: 'team-wire',
      hostPub: host.publicKeyB64u,
      teamName: '报文测试团',
    }),
  )
  const clientPub = await importEcdhPublicKey(client.publicKeyB64u)
  const hostPub = await importEcdhPublicKey(host.publicKeyB64u)
  const clientKey = await deriveSessionKey(client.privateKey, hostPub, sessionId, 'host<-client')
  const hostKey = await deriveSessionKey(host.privateKey, clientPub, sessionId, 'host<-client')
  const session = {
    ticket,
    keys: client,
    sessionKey: clientKey,
    link: {
      teamId: 'team-wire',
      memberId: 'm1',
      memberName: '测试成员',
      joinRequestId: 'jr-wire',
      deviceId: 'dev-wire',
      credential: 'credential-wire',
      localTripId: null,
      joinedAt: 1,
    },
  }

  const originalFetch = globalThis.fetch
  let requestAadOk = false
  globalThis.fetch = async (_input, init) => {
    const body = init?.body
    if (!(body instanceof Uint8Array)) throw new Error('请求体不是二进制')
    const plain = await openWithAad(
      hostKey,
      body,
      buildAad(sessionId, 'POST', '/action'),
    )
    const envelope = JSON.parse(new TextDecoder().decode(plain)) as {
      type: 'submission.submit'
      operationId: string
    }
    requestAadOk = envelope.type === 'submission.submit' && envelope.operationId === 'op-wire'
    const response = await sealWithAad(
      hostKey,
      utf8(JSON.stringify({ ok: true, result: { version: 7 } })),
      buildAad(sessionId, 'POST', '/action', {
        type: envelope.type,
        operationId: envelope.operationId,
      }),
    )
    return new Response(bytesToBase64(response), { status: 200 })
  }

  try {
    const res = await sendAction(session, 'submission.submit', { note: 'wire' }, 'op-wire')
    check('请求基础 AAD 与真实 postEnvelope 一致', requestAadOk)
    check('响应完整 AAD 可被客户端解密', res.ok && (res.result as { version: number }).version === 7)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ---------- 逐成员凭证（A15/A20） ----------

async function testCredential() {
  console.log('逐成员凭证')
  const secret = generateCredentialSecret()
  const c1 = await issueCredential(secret, 't1', 'm1', 'dev1')
  check('凭证稳定（同输入同结果）', c1 === (await issueCredential(secret, 't1', 'm1', 'dev1')))
  check('验证通过', await verifyCredential(secret, 't1', 'm1', 'dev1', c1))
  check('换设备标识验证失败（重绑定撤销旧设备）', !(await verifyCredential(secret, 't1', 'm1', 'dev2', c1)))
  check('换成员验证失败', !(await verifyCredential(secret, 't1', 'm2', 'dev1', c1)))
  check('换团队验证失败', !(await verifyCredential(secret, 't2', 'm1', 'dev1', c1)))

  const otherSecret = generateCredentialSecret()
  check('不同密钥签发的凭证不通过', !(await verifyCredential(otherSecret, 't1', 'm1', 'dev1', c1)))

  // 篡改凭证
  const bad = c1.slice(0, -2) + (c1.endsWith('AA') ? 'BB' : 'AA')
  check('篡改凭证拒绝', !(await verifyCredential(secret, 't1', 'm1', 'dev1', bad)))
}

// ---------- 会话码（不含长期秘密） ----------

async function testTicket() {
  console.log('会话码')
  const host = await generateEcdhKeyPair()
  const ticket = buildHostTicket({
    ip: '192.168.1.5',
    port: 41191,
    sessionId: 's1',
    teamId: 'team-1',
    hostPub: host.publicKeyB64u,
    teamName: '张家旅行团',
  })
  const parsed = parseHostTicket(ticket)
  check('往返解析一致', parsed.ip === '192.168.1.5' && parsed.port === 41191 && parsed.teamId === 'team-1')
  check('会话码含主机公钥', parsed.hostPub === host.publicKeyB64u)
  check('会话码不含私钥/凭证字样', !ticket.includes('credential') && !ticket.includes('secret'))

  await expectThrow('拒绝非团队码', async () => parseHostTicket('knapsack-session/1?ip=1.1.1.1&port=1&k=x&s=y'))
  await expectThrow('拒绝公钥格式错误', async () =>
    parseHostTicket('knapsack-team/1?ip=1.1.1.1&port=1&s=y&t=t&p=abcd&n=n'),
  )
}

// ---------- 加入 / 审批 / 恢复配对（A21） ----------

async function testJoinFlow() {
  console.log('加入/审批/恢复配对')
  const { createTeam, registerJoinRequest, approveJoin, getJoinStatus, resolveActor, rejectJoin } = await import(
    '../src/mods/mod-team/db/actions'
  )

  const team = await createTeam({ name: '加入测试团', organizerName: '甲' })
  const organizerId = team.roster[0].memberId

  // 首次申请
  const r1 = await registerJoinRequest({
    teamId: team.teamId,
    joinRequestId: 'jr-1',
    deviceId: 'dev-1',
    memberName: '乙',
    clientPub: 'pub-1',
  })
  check('申请登记为 pending', r1.ok && r1.status === 'pending')

  // 重复提交幂等
  const r2 = await registerJoinRequest({
    teamId: team.teamId,
    joinRequestId: 'jr-1',
    deviceId: 'dev-1',
    memberName: '乙',
    clientPub: 'pub-1',
  })
  check('同 joinRequestId 幂等', r2.ok && r2.status === 'pending')

  // 未审批时状态仍是 pending
  const st0 = await getJoinStatus(team.teamId, 'jr-1')
  check('未审批前拿不到凭证', st0.ok && st0.status === 'pending')

  // 非组织者不能审批
  const badApprove = await approveJoin({
    teamId: team.teamId,
    organizerMemberId: 'not-organizer',
    joinRequestId: 'jr-1',
  })
  check('非组织者审批被拒', !badApprove.ok)

  // 组织者审批
  const appr = await approveJoin({ teamId: team.teamId, organizerMemberId: organizerId, joinRequestId: 'jr-1' })
  check('审批通过并签发凭证', appr.ok && !!appr.credential && !appr.restored)

  const st1 = await getJoinStatus(team.teamId, 'jr-1')
  check('审批后可取凭证', st1.ok && st1.status === 'approved')

  if (appr.ok) {
    const actor = await resolveActor(team.teamId, {
      memberId: appr.memberId,
      deviceId: 'dev-1',
      credential: appr.credential,
    })
    check('凭证可推导作者', !!actor && actor.memberId === appr.memberId && actor.role === 'member')

    const badActor = await resolveActor(team.teamId, {
      memberId: appr.memberId,
      deviceId: 'dev-1',
      credential: appr.credential.slice(0, -2) + 'ZZ',
    })
    check('篡改凭证不能推导作者（A15）', badActor === null)

    const wrongDevice = await resolveActor(team.teamId, {
      memberId: appr.memberId,
      deviceId: 'dev-other',
      credential: appr.credential,
    })
    check('换设备标识不能通过（重绑定撤销旧设备）', wrongDevice === null)
  }

  // 恢复配对：审批响应丢失后重新申请，保留原 memberId，不重复名册
  const before = await import('../src/mods/mod-team/db/actions').then((m) => m.getTeam(team.teamId))
  const rosterBefore = before!.roster.length

  const r3 = await registerJoinRequest({
    teamId: team.teamId,
    joinRequestId: 'jr-2',
    deviceId: 'dev-1',
    memberName: '乙',
    clientPub: 'pub-2',
  })
  check('恢复配对：新申请登记', r3.ok)

  const restored = await approveJoin({
    teamId: team.teamId,
    organizerMemberId: organizerId,
    joinRequestId: 'jr-2',
    restoreMemberId: appr.ok ? appr.memberId : undefined,
  })
  check('恢复配对保留原 memberId', restored.ok && appr.ok && restored.memberId === appr.memberId)
  check('恢复配对标记 restored=true', restored.ok && restored.restored === true)

  const after = await import('../src/mods/mod-team/db/actions').then((m) => m.getTeam(team.teamId))
  check('名册未重复（人数不变）', after!.roster.length === rosterBefore)

  // 拒绝路径
  await registerJoinRequest({
    teamId: team.teamId,
    joinRequestId: 'jr-3',
    deviceId: 'dev-9',
    memberName: '丙',
    clientPub: 'pub-3',
  })
  const rej = await rejectJoin(team.teamId, organizerId, 'jr-3')
  check('组织者可拒绝', rej.ok)
  const st3 = await getJoinStatus(team.teamId, 'jr-3')
  check('拒绝后状态为 rejected 且不带凭证', st3.ok && st3.status === 'rejected')
}

// ---------- 运行 ----------

async function main() {
  await testEcdh()
  await testAad()
  await testSendActionWire()
  await testCredential()
  await testTicket()
  await testJoinFlow()
  if (failed > 0) {
    console.error(`\n${failed} 项失败`)
    process.exit(1)
  } else {
    console.log('\n全部通过')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
