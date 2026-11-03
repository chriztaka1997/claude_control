// node-pty ships a spawn-helper binary that npm sometimes unpacks without the
// executable bit, which makes every spawn fail with "posix_spawnp failed".
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join('node_modules', 'node-pty')
const dirs = [join(root, 'build', 'Release')]
const prebuilds = join(root, 'prebuilds')
if (existsSync(prebuilds)) for (const d of readdirSync(prebuilds)) dirs.push(join(prebuilds, d))

for (const dir of dirs) {
  const helper = join(dir, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
