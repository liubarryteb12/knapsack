/**
 * Windows sandbox compatibility shim.
 *
 * Node 24 can return ENOMEM from uv_os_get_passwd in this environment before tsx
 * loads a project file. tsx only asks for the account name to pick a temp path,
 * so a deterministic workspace-safe value is sufficient for local test runs.
 */
import os from 'node:os'
import path from 'node:path'

const fallbackUser = {
  uid: -1,
  gid: -1,
  username: process.env.USERNAME || 'codespace',
  homedir: process.env.USERPROFILE || process.cwd(),
  shell: null,
}

try {
  os.userInfo()
} catch {
  Object.defineProperty(os, 'userInfo', {
    configurable: true,
    value: () => fallbackUser,
  })
}

if (!process.env.TMPDIR) {
  process.env.TMPDIR = path.join(process.cwd(), '.tmp')
}
