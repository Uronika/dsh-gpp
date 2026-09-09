// engine.mjs — GPP 混合检索引擎（零依赖，供 gpp-rag.js 插件与 eval.mjs 共用）。
// 索引格式：{ version, vectorDim, chunks: [...] }，chunks 含 text/元数据/可选 vector。

export const DEFAULT_ALPHA = 0.55
export const DEFAULT_MODEL = 'bge-m3'
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

// ── 分词 ───────────────────────────────────────────────────────────────────
const STOP_EN = new Set(('a an the and or of to in is are it its that this with for on as at by be not but if then else ' +
  'you your we our they their he she his her can could will would should do does did have has had was were been being ' +
  'from so such than when where which who whom what how why i me my us them more most some any all no yes just about ' +
  'into over under out up down off very much many few little new old same other only also too while because until after ' +
  'before between again once here there these those both each every one two may might must get got make made use used ' +
  'using like want need let way even still well thing things').split(' '))

function stemEn(w) {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2)
  return w
}

function tokenizeEn(text) {
  const out = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue
    if (STOP_EN.has(raw)) continue
    const w = stemEn(raw)
    if (w.length >= 2) out.push('e:' + w)
  }
  return out
}

function tokenizeZh(text) {
  const out = []
  for (const phrase of text.split(/[^\u4e00-\u9fff]+/)) {
    if (!phrase) continue
    out.push('z:' + phrase)
    if (phrase.length >= 2) {
      for (let i = 0; i < phrase.length - 1; i++) out.push('z:' + phrase.slice(i, i + 2))
    }
  }
  return out
}

export function tokenize(text) {
  return [...tokenizeEn(text), ...tokenizeZh(text)]
}

// ── 文档字段（field 0=正文, 1=标题/模式名, 2=双语关键词）────────────────
const FIELD_WEIGHTS = [1, 4, 3]
const K1 = 1.5
const B = 0.75
const TOP_CANDIDATES = 120

function fieldsOf(c) {
  return [
    { tokens: tokenize(c.text) },
    { tokens: tokenize([c.section, c.patternZh, c.patternEn, c.chapterTitle, c.chapterZh, c.categoryZh].filter(Boolean).join(' ')) },
    { tokens: tokenize([...(c.zhKeywords ?? []), ...(c.enKeywords ?? [])].join(' ')) },
  ]
}

// ── 索引准备 ───────────────────────────────────────────────────────────────
export function prepareIndex(index) {
  const chunks = index.chunks
  const docs = chunks.map((c) => ({ c, fields: fieldsOf(c) }))
  const stats = []
  for (let f = 0; f < 3; f++) {
    const df = new Map()
    let totalLen = 0
    for (const d of docs) {
      const seen = new Set()
      for (const t of d.fields[f].tokens) {
        if (!seen.has(t)) {
          seen.add(t)
          df.set(t, (df.get(t) ?? 0) + 1)
        }
        totalLen++
      }
    }
    stats.push({ df, avgLen: totalLen / Math.max(1, docs.length), N: docs.length })
  }
  return { chunks, docs, stats, useSemantic: (index.vectorDim ?? 0) > 0 }
}

// ── 过滤规范化 ─────────────────────────────────────────────────────────────
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

export function filterChunks(prep, filters) {
  if (!filters) return prep.docs
  const { pattern, category } = filters
  return prep.docs.filter((d) => {
    const c = d.c
    if (pattern) {
      const p = slug(pattern)
      const ok = c.pattern === p || slug(c.patternEn ?? '') === p || slug(c.patternZh ?? '') === p
      if (!ok) return false
    }
    if (category) {
      const g = slug(category)
      const ok = (c.category ?? '') === g || slug(c.categoryZh ?? '') === g
      if (!ok) return false
    }
    return true
  })
}

// ── BM25 ───────────────────────────────────────────────────────────────────
function bm25Field(tfs, len, f, stats) {
  const { df, avgLen, N } = stats[f]
  let s = 0
  for (const [t, tf] of tfs) {
    const d = df.get(t) ?? 0
    if (d === 0) continue
    const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5))
    s += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avgLen)))
  }
  return s
}

function scoreBm25(docs, queryTokens, stats) {
  const out = []
  for (const d of docs) {
    let bm25 = 0
    for (let f = 0; f < 3; f++) {
      const tfs = new Map()
      for (const t of d.fields[f].tokens) {
        if (queryTokens.has(t)) tfs.set(t, (tfs.get(t) ?? 0) + 1)
      }
      if (tfs.size) bm25 += FIELD_WEIGHTS[f] * bm25Field(tfs, d.fields[f].tokens.length, f, stats)
    }
    out.push({ d, bm25 })
  }
  return out
}

// ── 语义 ───────────────────────────────────────────────────────────────────
export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}

export async function embedTexts(texts, ollamaUrl = DEFAULT_OLLAMA_URL, model = DEFAULT_MODEL) {
  const r = await fetch(`${ollamaUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  })
  if (!r.ok) throw new Error(`embed HTTP ${r.status}`)
  const j = await r.json()
  return j.embeddings
}

export async function ollamaHealthy(ollamaUrl = DEFAULT_OLLAMA_URL, timeoutMs = 800) {
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

// ── 混合检索 ───────────────────────────────────────────────────────────────
// opts: { alpha, topK, filters, queryVector, skipSemantic, ollamaUrl, model }
export async function searchPrepared(prep, query, opts = {}) {
  const alpha = opts.alpha ?? DEFAULT_ALPHA
  const topK = Math.min(Math.max(opts.topK ?? 5, 1), 10)
  const qTokens = new Set(tokenize(query))
  const pool = filterChunks(prep, opts.filters)
  if (pool.length === 0) return { hits: [], mode: 'empty-filter', semantic: false }

  const scored = scoreBm25(pool, qTokens, prep.stats).sort((a, b) => b.bm25 - a.bm25)
  const candidates = scored.slice(0, TOP_CANDIDATES)
  const maxBm25 = candidates.length && candidates[0].bm25 > 0 ? candidates[0].bm25 : 1

  let semantic = false
  let qv = opts.queryVector
  if (!qv && prep.useSemantic && !opts.skipSemantic) {
    try {
      const vecs = await embedTexts([query], opts.ollamaUrl, opts.model)
      qv = vecs[0]
    } catch {
      qv = null
    }
  }
  if (qv && qv.length > 0) {
    semantic = true
    let maxCos = 0
    const cos = candidates.map(({ d, bm25 }) => {
      const cs = cosine(qv, d.c.vector)
      maxCos = Math.max(maxCos, cs)
      return { d, bm25, cs }
    })
    const merged = cos.map(({ d, bm25, cs }) => ({
      chunk: d.c,
      bm25,
      cos: cs,
      score: alpha * (bm25 / maxBm25) + (1 - alpha) * (cs / Math.max(1e-9, maxCos)),
    }))
    merged.sort((a, b) => b.score - a.score)
    return { hits: merged.slice(0, topK), mode: 'hybrid', semantic: true }
  }
  return {
    hits: candidates.slice(0, topK).map(({ d, bm25 }) => ({ chunk: d.c, bm25, cos: null, score: bm25 / maxBm25 })),
    mode: 'lexical',
    semantic: false,
  }
}

// ── 摘录 ───────────────────────────────────────────────────────────────────
export function excerpt(text, max = 700) {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}
