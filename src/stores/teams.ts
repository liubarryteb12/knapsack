import { defineStore } from 'pinia'
import {
  createTeam as createTeamDb,
  listTeamSummaries,
  getTeam,
  saveTeam,
  getTeamLink,
  pendingOutbox,
} from '../db/teamActions'
import type { TeamState } from '../team/schema'
import type { TeamListItem } from '../db/teamActions'
import type { TeamLink, TeamOutboxEntry } from '../db/teamSchema'

/** 团队 store：缓存团队聚合与配对信息；写操作委托 db/teamActions 的事务 */
/**
 * teams：已打开过详情的团队，存完整聚合根（编辑/确认/发布都从这里读）。
 * teamList：列表页投影，只有展示字段（teamId/name/roster/各计数/发布状态）。
 *
 * 分开存是为了避免列表页把每个团队的 submissions/expenses 全搬进内存，
 * 而进详情又会再取一份完整聚合根——同一份数据存两遍。
 */
export const useTeamsStore = defineStore('teams', {
  state: () => ({
    teams: [] as TeamState[],
    teamList: [] as TeamListItem[],
    links: {} as Record<string, TeamLink | null>,
    outbox: {} as Record<string, TeamOutboxEntry[]>,
    loaded: false,
  }),

  getters: {
    /** 我作为组织者创建的团队 */
    hostedTeams: (state) =>
      state.teams.filter((t) => {
        const me = t.roster.find((m) => m.memberId === t.myMemberId)
        return me?.role === 'organizer'
      }),
    /** 我作为成员加入的团队 */
    joinedTeams: (state) =>
      state.teams.filter((t) => {
        const me = t.roster.find((m) => m.memberId === t.myMemberId)
        return !!me && me.role !== 'organizer'
      }),
    byId: (state) => (teamId: string) => state.teams.find((t) => t.teamId === teamId),
  },

  actions: {
    async load() {
      this.teamList = await listTeamSummaries()
      const links: Record<string, TeamLink | null> = {}
      for (const t of this.teamList) {
        links[t.teamId] = (await getTeamLink(t.teamId)) ?? null
      }
      this.links = links
      this.loaded = true
    },

    async create(name: string, organizerName: string): Promise<TeamState> {
      const t = await createTeamDb({ name, organizerName })
      this.teams.push(t)
      this.teamList.push(toListItem(t))
      return t
    },

    async refresh(teamId: string): Promise<TeamState | undefined> {
      const t = await getTeam(teamId)
      if (t) {
        const idx = this.teams.findIndex((x) => x.teamId === teamId)
        if (idx >= 0) this.teams.splice(idx, 1, t)
        else this.teams.push(t)
      }
      return t
    },

    async persist(state: TeamState): Promise<TeamState> {
      const saved = await saveTeam(state)
      const idx = this.teams.findIndex((x) => x.teamId === saved.teamId)
      if (idx >= 0) this.teams.splice(idx, 1, saved)
      else this.teams.push(saved)
      return saved
    },

    async loadOutbox(teamId: string) {
      this.outbox[teamId] = await pendingOutbox(teamId)
    },

    async loadLink(teamId: string) {
      this.links[teamId] = (await getTeamLink(teamId)) ?? null
      return this.links[teamId]
    },
  },
})

/** 完整聚合根 → 列表投影。与 listTeamSummaries 的字段保持一致。 */
function toListItem(t: TeamState): TeamListItem {
  return {
    teamId: t.teamId,
    name: t.name,
    myMemberId: t.myMemberId,
    draftRevision: t.draftRevision,
    roster: t.roster,
    items: t.items.map((i) => ({ itemId: i.itemId })),
    allocations: t.allocations.map((a) => ({ allocationId: a.allocationId })),
    checkpoints: t.checkpoints.map((c) => ({ checkpointId: c.checkpointId })),
    latestPublication: t.latestPublication,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}