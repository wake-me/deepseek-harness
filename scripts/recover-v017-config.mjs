/** One-shot recovery for config dropped or orphaned by the v0.1.7 settings/preset migrations. */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'

const home = homedir()
const dsh = `${home}/.dsh`
const patchPath = `${dsh}/profiles/web/cordis.patch.yml`
const importedPath = `${dsh}/settings.yaml.imported`
const presetsRoot = `${dsh}/.agent-presets`
const desktopConfigPath = `${home}/.dsh-desktop.json`

class JsExpr { constructor(raw) { this.raw = raw } }
const jsType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: data => new JsExpr(String(data)),
  represent: node => node.raw,
  instanceOf: JsExpr,
})
const schema = yaml.DEFAULT_SCHEMA.extend([jsType])

const MODEL_SECTIONS = ['llm-pi-ai', 'llm-deepseek', 'agent-default-model']
const urlRe = /new URL\('([^']+)', baseUrl\)/

const actions = []
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
const hasEntry = id => patch.includes(`id: ${id}\n`) || patch.includes(`id: ${id}\r\n`)

const transformBaseUrl = (node, preset) => {
  if (node instanceof JsExpr) {
    const m = node.raw.match(urlRe)
    return m !== null ? path.join(presetsRoot, preset, m[1]) : node
  }
  if (Array.isArray(node)) return node.map(item => transformBaseUrl(item, preset))
  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) node[key] = transformBaseUrl(node[key], preset)
  }
  return node
}

let additions = ''

if (existsSync(importedPath)) {
  const doc = yaml.load(readFileSync(importedPath, 'utf8'), { schema })
  const restored = MODEL_SECTIONS.filter(section => doc[section] !== undefined && !hasEntry(section))
  if (restored.length > 0) {
    additions += '\n# Model sections restored from settings.yaml.imported after the v0.1.7 settings migration.\n'
    for (const section of restored) {
      additions += yaml.dump([{ id: section, name: `@deepseek-ai/dsh-${section}`, config: doc[section] }],
        { schema, lineWidth: 120, noRefs: true, quotingType: "'" })
    }
    actions.push(`restored model sections: ${restored.join(', ')}`)
  }
} else {
  actions.push('no settings.yaml.imported — start the desktop once to trigger the migration, then rerun')
}

if (existsSync(presetsRoot)) {
  const entries = []
  for (const name of ['anthropic-bi', 'data-analyst', 'pm-lab', 'uiux-lab', 'visual-diagram-design']) {
    const composition = `${presetsRoot}/${name}/agent.cordis.yml`
    if (!existsSync(composition) || hasEntry(`preset-${name}`)) continue
    const rows = yaml.load(readFileSync(composition, 'utf8'), { schema })
    const meta = existsSync(`${presetsRoot}/${name}/preset.yml`)
      ? yaml.load(readFileSync(`${presetsRoot}/${name}/preset.yml`, 'utf8')) : {}
    entries.push({
      id: `preset-${name}`,
      name: '@deepseek-ai/dsh-agent-preset',
      config: { id: name, name: meta.name, description: meta.description, plugins: transformBaseUrl(rows, name) },
    })
  }
  if (entries.length > 0) {
    additions += '\n# Agent presets migrated from ~/.dsh/.agent-presets after v0.1.7 removed directory discovery.\n'
    additions += yaml.dump([{ insert: entries }], { schema, lineWidth: 120, noRefs: true, quotingType: "'" })
    actions.push(`migrated presets: ${entries.map(entry => entry.config.id).join(', ')}`)
  }
} else {
  actions.push('no ~/.dsh/.agent-presets directory — nothing to migrate')
}

if (additions !== '') {
  copyFileSync(patchPath, `${patchPath}.bak-recover`)
  writeFileSync(patchPath, patch.trimEnd() + '\n' + additions)
  actions.push(`patched ${patchPath} (backup: cordis.patch.yml.bak-recover)`)
}

if (existsSync(desktopConfigPath)) {
  const config = JSON.parse(readFileSync(desktopConfigPath, 'utf8'))
  if (config.theme === undefined) {
    config.theme = 'dark'
    writeFileSync(desktopConfigPath, JSON.stringify(config, null, 2))
    actions.push('set desktop shell theme to dark in ~/.dsh-desktop.json')
  }
}

console.log(actions.length > 0 ? actions.map(line => `- ${line}`).join('\n') : '- nothing to do: everything already recovered')
console.log('\nRemaining manual steps:')
console.log('1. cd ~/.dsh/profiles/web && pnpm add dshmarket@1.58.0   # plugin market fix')
console.log('2. Fully quit and reopen the desktop app')
console.log('3. Re-select the Think preview line count once (Settings → General)')
