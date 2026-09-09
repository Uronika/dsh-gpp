// gpp-rag.js — 《Game Programming Patterns》本地混合检索工具插件（Host 侧）。
//
// 注册模型工具 gpp_search：对 gpp-data/index.json 做
// BM25（双语关键词加权）+ bge-m3 语义 的混合检索。
// Ollama 不可用时自动降级为纯词汇检索并在结果中明确标注。
// 只注册工具、不发布服务，组合行无需 isolate realm（与 tool-web 同级）。
//
// 注意：预设本地插件文件的相对 import 走 Node 正常解析（从插件文件位置向上找
// node_modules，到不了 harness 依赖），因此本文件只允许 import node: 内置模块；
// 工具注册使用 tools 服务的原始 ToolDefinition 契约（不依赖 @deepseek-ai/dsh-tools）。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  prepareIndex,
  searchPrepared,
  ollamaHealthy,
  excerpt,
  DEFAULT_ALPHA,
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_URL,
} from './gpp-engine.mjs'

const name = 'tool-gpp-rag'
const inject = ['tools']

// 每个数据目录一份内存索引，进程内跨会话共享（只读缓存，无碰撞风险）。
let cache = null

function loadIndex(dataDir) {
  if (cache?.dataDir === dataDir) return cache.promise
  const promise = (async () => {
    const raw = await readFile(join(dataDir, 'index.json'), 'utf8')
    return prepareIndex(JSON.parse(raw))
  })()
  cache = { dataDir, promise }
  return promise
}

function modeNote(mode) {
  if (mode === 'hybrid') return ''
  if (mode === 'lexical-ollama-down') {
    return '⚠️ Ollama 未运行（或 bge-m3 未安装），本次为纯词汇检索，语义相关但用词不同的内容可能漏掉。'
  }
  return '（索引未含语义向量，本次为纯词汇检索。）'
}

function renderHits(args, value) {
  const lines = []
  const note = modeNote(value.mode)
  if (note) lines.push(note)
  if (value.hits.length === 0) {
    lines.push('没有命中。请换一种问法（面向问题描述而非模式名），或去掉 pattern/category 过滤。')
  }
  for (const [i, h] of value.hits.entries()) {
    const title = [
      h.chapterTitle,
      h.patternZh ? `（${h.patternZh}）` : '',
      h.categoryZh ? `[${h.categoryZh}]` : '',
    ].join(' ')
    const parts = [`${i + 1}. ${h.section} — ${title} (score ${h.score.toFixed(3)})`]
    if (h.unityIdiom) parts.push(`   Unity 惯用法：${h.unityIdiom}`)
    parts.push(`   ${excerpt(h.excerpt).replace(/\n/g, ' ')}`)
    lines.push(parts.join('\n'))
  }
  if (value.hits.length > 0) {
    const chapters = [...new Set(value.hits.map((h) => h.chapter))]
    lines.push(`完整原文可直接读取：${value.bookDir} 下对应章节（${chapters.join('、')}）。`)
  }
  return lines.join('\n\n')
}

function apply(ctx, config) {
  const cfg = config ?? {}
  const dataDir = typeof cfg.dataDir === 'string' && cfg.dataDir !== ''
    ? cfg.dataDir
    : fileURLToPath(new URL('../gpp-data/', import.meta.url))
  const ollamaUrl = typeof cfg.ollamaUrl === 'string' ? cfg.ollamaUrl : DEFAULT_OLLAMA_URL
  const model = typeof cfg.model === 'string' ? cfg.model : DEFAULT_MODEL
  const alpha = typeof cfg.alpha === 'number' && cfg.alpha > 0 && cfg.alpha <= 1 ? cfg.alpha : DEFAULT_ALPHA

  ctx.tools.register({
    name: 'gpp_search',
    description:
      '检索 Robert Nystrom《Game Programming Patterns》的本地全文索引（含 19 个设计模式的中英双语元数据与 Unity C# 惯用法映射）。' +
      '在做游戏架构/系统设计决策前使用：把工程问题描述成查询（中英文均可），例如「大量子弹频繁创建销毁怎么避免 GC 压力」而非「Object Pool」。' +
      '返回命中的章节、小节、相关模式与摘录；可用 pattern/category 过滤；Ollama 不可用时自动降级为纯词汇检索。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '面向工程问题的检索描述，中英文均可；不要只写模式名。' },
        pattern: { type: 'string', description: '可选：限定到某个模式（slug 或中英文名，如 object-pool / 对象池 / Object Pool）。' },
        category: { type: 'string', description: '可选：限定到某个分类（如 design-patterns-revisited / 优化模式）。' },
        topK: { type: 'number', description: '返回条数，默认 5，最大 10。' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string' },
          bookDir: { type: 'string' },
          hits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                chapter: { type: 'string' },
                chapterTitle: { type: 'string' },
                chapterZh: { type: 'string' },
                section: { type: 'string' },
                pattern: { type: 'string' },
                patternZh: { type: 'string' },
                category: { type: 'string' },
                categoryZh: { type: 'string' },
                score: { type: 'number' },
                unityIdiom: { type: 'string' },
                excerpt: { type: 'string' },
              },
              required: ['id', 'chapter', 'chapterTitle', 'section', 'score', 'excerpt'],
            },
          },
        },
        required: ['mode', 'bookDir', 'hits'],
      },
      render: (args, value) => [{ type: 'text', text: renderHits(args, value) }],
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (typeof args.query !== 'string' || args.query.trim() === '') {
        throw new Error('query 必须是非空字符串')
      }
      const prep = await loadIndex(dataDir)
      let ollamaDown = false
      if (prep.useSemantic && !(await ollamaHealthy(ollamaUrl))) ollamaDown = true
      const filters = {}
      if (typeof args.pattern === 'string' && args.pattern !== '') filters.pattern = args.pattern
      if (typeof args.category === 'string' && args.category !== '') filters.category = args.category
      const { hits, semantic } = await searchPrepared(prep, args.query, {
        alpha,
        topK: args.topK ?? 5,
        filters: Object.keys(filters).length ? filters : undefined,
        skipSemantic: ollamaDown,
        ollamaUrl,
        model,
      })
      const mode = semantic ? 'hybrid' : prep.useSemantic ? 'lexical-ollama-down' : 'lexical-no-embeddings'
      return {
        mode,
        bookDir: join(dataDir, 'book', 'book'),
        hits: hits.map((h) => ({
          id: h.chunk.id,
          chapter: h.chunk.chapter,
          chapterTitle: h.chunk.chapterTitle,
          chapterZh: h.chunk.chapterZh,
          section: h.chunk.section,
          pattern: h.chunk.pattern,
          patternZh: h.chunk.patternZh,
          category: h.chunk.category,
          categoryZh: h.chunk.categoryZh,
          score: h.score,
          unityIdiom: h.chunk.unityIdiom,
          excerpt: h.chunk.text,
        })),
      }
    },
  })
}

export { apply, inject, name }
