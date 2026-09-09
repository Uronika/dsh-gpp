#!/usr/bin/env node
// build.mjs — 构建《Game Programming Patterns》混合检索索引。
//
// 流程：解析书仓 markdown（结构感知切块，代码段按 script/format.py 的语义内联）
//   → 拼接 patterns.json 双语元数据 → 生成 chunks → 调用 Ollama bge-m3 逐块嵌入
//   → 写出 index.json（插件运行时全量加载）。
//
// 用法：node build.mjs [--no-embed]

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const BOOK_DIR = path.join(ROOT, 'book', 'book')
const CPP_DIR = path.join(ROOT, 'book', 'code', 'cpp')
const PATTERNS = JSON.parse(readFileSync(path.join(ROOT, 'patterns.json'), 'utf8'))

const EMBED_MODEL = 'bge-m3'
const OLLAMA_URL = 'http://127.0.0.1:11434'
const EMBED_BATCH = 16
const EMBED_MAX_CHARS = 5000
const EMBED_RETRIES = 3

const noEmbed = process.argv.includes('--no-embed')
const log = (...args) => console.log('[build]', ...args)

// ── 代码段提取：忠实复刻 script/format.py 的 include_code ──────────────────
const snippetCache = new Map()
function extractSnippet(chapterBase, name) {
  const key = `${chapterBase}::${name}`
  if (snippetCache.has(key)) return snippetCache.get(key)
  let result = null
  const hPath = path.join(CPP_DIR, `${chapterBase}.h`)
  if (existsSync(hPath)) {
    const lines = readFileSync(hPath, 'utf8').split(/\r?\n/)
    let inBlock = false
    let omitting = false
    let omittingName = false
    let blockIndent = 0
    const out = []
    for (const line of lines) {
      const stripped = line.trim()
      if (inBlock) {
        if (stripped === `//^${name}`) break
        else if (stripped === '//^omit') omitting = !omitting
        else if (stripped === `//^omit ${name}`) omittingName = !omittingName
        else if (stripped.startsWith('//^')) { /* 其他代码段标记，忽略 */ }
        else if (!omitting && !omittingName) {
          if (stripped === '') out.push('')
          else out.push(line.slice(blockIndent))
        }
      } else if (stripped === `//^${name}`) {
        inBlock = true
        blockIndent = line.length - line.trimStart().length
      }
    }
    if (inBlock) result = out.join('\n').trim()
  }
  snippetCache.set(key, result)
  return result
}

// ── 文本清理 ───────────────────────────────────────────────────────────────
const ENTITIES = [
  ['&ndash;', '–'], ['&mdash;', '—'], ['&hellip;', '…'], ['&times;', '×'],
  ['&copy;', '©'], ['&quot;', '"'], ['&#39;', "'"], ['&lt;', '<'], ['&gt;', '>'],
  ['&shy;', ''], ['&nbsp;', ' '], ['&#8202;', ''], ['&amp;', '&'],
]
function cleanText(text) {
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*\/?>/g, (_m, alt) => (alt ? `[图: ${alt}]` : ''))
  text = text.replace(/<[^>]+>/g, '')
  for (const [e, c] of ENTITIES) text = text.split(e).join(c)
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// ── 章节解析：^title / ^section / ^code / ## 小节 ─────────────────────────
function parseChapter(fileName) {
  const base = fileName.replace(/\.markdown$/, '')
  const raw = readFileSync(path.join(BOOK_DIR, fileName), 'utf8').split(/\r?\n/)
  let title = base
  let sectionName = null
  let current = { heading: title, text: [] }
  const sections = []
  for (const line of raw) {
    const stripped = line.trimStart()
    if (stripped.startsWith('^')) {
      const space = stripped.indexOf(' ')
      const cmd = stripped.slice(1, space === -1 ? undefined : space)
      const args = space === -1 ? '' : stripped.slice(space + 1).trim()
      if (cmd === 'title') title = args.replace(/&shy;/g, '')
      else if (cmd === 'section') sectionName = args
      else if (cmd === 'code') {
        const code = extractSnippet(base, args)
        if (code) current.text.push('```cpp\n' + code + '\n```')
      }
      // ^outline 等其他指令：忽略
    } else if (/^#{2,3}\s/.test(stripped)) {
      sections.push(current)
      current = { heading: cleanText(stripped.replace(/^#+\s*/, '')), text: [] }
    } else {
      current.text.push(line)
    }
  }
  sections.push(current)
  const parsed = []
  for (const s of sections) {
    const text = cleanText(s.text.join('\n'))
    if (text.length >= 40) parsed.push({ heading: s.heading, text })
  }
  return { base, title: cleanText(title), sectionName, sections: parsed }
}

// ── 组装 chunks ────────────────────────────────────────────────────────────
function assembleChunks(fileName) {
  const { base, title, sections } = parseChapter(fileName)
  const p = PATTERNS.patterns[base]
  const c = PATTERNS.chapters[base] ?? {}
  return sections.map((s, i) => ({
    id: `${base}/${String(i).padStart(2, '0')}`,
    chapter: fileName,
    chapterTitle: title,
    chapterZh: p?.zh ?? c.zh ?? null,
    section: s.heading,
    pattern: p ? base : null,
    patternEn: p?.en ?? null,
    patternZh: p?.zh ?? null,
    category: p?.category ?? c.category ?? null,
    categoryZh: p?.categoryZh ?? c.categoryZh ?? null,
    related: p?.related ?? [],
    unityIdiom: p?.unityIdiom ?? null,
    zhKeywords: [...(c.zhKeywords ?? []), ...(p?.zhKeywords ?? [])],
    enKeywords: p?.enKeywords ?? [],
    text: s.text,
  }))
}

// ── bge-m3 嵌入 ────────────────────────────────────────────────────────────
function chunkEmbedInput(c) {
  const parts = [c.chapterTitle]
  if (c.patternZh) parts.push(c.patternZh)
  if (c.categoryZh) parts.push(c.categoryZh)
  parts.push(c.section)
  const meta = []
  if (c.zhKeywords.length) meta.push(c.zhKeywords.join(' '))
  if (c.unityIdiom) meta.push(`Unity 惯用法: ${c.unityIdiom}`)
  return `${parts.join(' · ')}\n${meta.join('\n')}\n\n${c.text.slice(0, EMBED_MAX_CHARS)}`
}

async function embedBatch(texts) {
  let lastErr
  for (let attempt = 1; attempt <= EMBED_RETRIES; attempt++) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
      const j = await r.json()
      if (!Array.isArray(j.embeddings)) throw new Error(`unexpected response: ${JSON.stringify(j).slice(0, 200)}`)
      return j.embeddings
    } catch (err) {
      lastErr = err
      log(`embed 批次失败(第 ${attempt} 次): ${err.message}`)
      await new Promise((res) => setTimeout(res, 3000 * attempt))
    }
  }
  throw new Error(`embed 连续失败: ${lastErr.message}`)
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
async function main() {
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(BOOK_DIR))
    .filter((n) => n.endsWith('.markdown') && n !== 'acknowledgements.markdown')
    .sort()

  const chunks = []
  for (const name of names) {
    const cs = assembleChunks(name)
    log(`${name}: ${cs.length} 块`)
    chunks.push(...cs)
  }
  log(`共 ${chunks.length} 个 chunk`)

  if (!noEmbed) {
    // 健康检查
    try {
      const v = await fetch(`${OLLAMA_URL}/api/version`)
      if (!v.ok) throw new Error(`HTTP ${v.status}`)
      log('Ollama 服务在线')
    } catch (err) {
      throw new Error(`Ollama 服务不可用（${err.message}）——先启动服务，或加 --no-embed 只建词汇索引`)
    }

    const started = Date.now()
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const vecs = await embedBatch(batch.map(chunkEmbedInput))
      batch.forEach((c, j) => { c.vector = vecs[j] })
      log(`嵌入进度 ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length} (${(((i + EMBED_BATCH) / chunks.length) * 100).toFixed(0)}%)`)
    }
    log(`嵌入完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    source: 'https://github.com/munificent/game-programming-patterns（正文 CC BY-NC-ND 4.0 / 代码 MIT，本地个人使用）',
    embeddingModel: noEmbed ? null : EMBED_MODEL,
    vectorDim: noEmbed ? 0 : (chunks[0]?.vector?.length ?? 0),
    chunkCount: chunks.length,
    chunks,
  }
  const out = path.join(ROOT, 'index.json')
  writeFileSync(out, JSON.stringify(index))
  const { stat } = await import('node:fs/promises')
  const kb = Math.round((await stat(out)).size / 1024)
  log(`index.json 已写出：${chunks.length} chunks，${kb} KB`)
}

main().catch((err) => {
  console.error('[build] 失败：', err.message)
  process.exit(1)
})
