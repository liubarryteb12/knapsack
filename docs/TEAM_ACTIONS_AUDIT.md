# teamActions.ts 审计与拆分边界

日期：2026-10-23
文件：`src/db/teamActions.ts`（约 57 KB）

## 当前职责

| 职责组 | 代表函数 | 风险 |
|---|---|---|
| 幂等基础设施 | `idempotencyKey`、`checkIdempotent`、`inTxIdempotent` | 被多个业务组共享 |
| 报告提交/确认/撤回 | `acceptSubmission`、`decideSubmission`、`withdrawSubmission` | 事务、修订、费用入账耦合 |
| 发布 | `publishSnapshot`、`ingestPublication`、`latestPublicationOf` | 快照、幂等、预览摘要 |
| 回执/outbox | `acceptReceipt`、`queueOutbox`、`pendingOutbox`、`clearOutbox` | 成员端补传与主机端单调性 |
| 团队/名册/加入 | `createTeam`、`saveTeam`、`registerJoinRequest`、`approveJoin`、`rejectJoin` | 身份、凭证、名册和事务 |
| 查询投影 | `getTeam`、`listTeams`、`listTeamSummaries` | 列表投影与完整聚合根分离 |
| 身份解析 | `resolveActor`、`getCredentialSecret` | 凭证校验与团队存储耦合 |

## 拆分建议

不在 v1.1.0 候选版直接拆，避免发布前引入回归。v1.1.x 可按以下边界渐进拆分：

1. `src/team/persistence/teamRepository.ts`
   - `getTeam`、`saveTeam`、`listTeamSummaries`、`getPublication`、`latestPublicationOf`
2. `src/team/services/submissionService.ts`
   - `acceptSubmission`、`decideSubmission`、`withdrawSubmission`
3. `src/team/services/publicationService.ts`
   - `publishSnapshot`、`ingestPublication`
4. `src/team/services/receiptService.ts`
   - `acceptReceipt`、outbox helpers
5. `src/team/services/identityService.ts`
   - join/approve/reject、`resolveActor`、`getCredentialSecret`
6. `src/team/persistence/idempotency.ts`
   - `idempotencyKey`、`inTxIdempotent`

## 约束

- 拆分只移动职责，不改变 schema、协议、幂等键或事务边界。
- 每次拆分必须运行 `test-team-db`、`test-team-identity`、`test-team-file`。
- 发布候选版期间不做大文件搬迁。
