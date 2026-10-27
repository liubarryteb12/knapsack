import { syncModManifestIndex } from './lib/mod-index.mjs'

const result = syncModManifestIndex()
console.log(`mod_manifest_count=${result.count}`)
console.log(`mod_manifest_index=${result.output}`)
