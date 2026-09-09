#!/usr/bin/env node
// eval.mjs — 检索质量验收（走 engine.mjs 同一份实现）。
// 用法：node eval.mjs [--no-semantic] [--alpha 0.55] [--verbose]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIndex, searchPrepared, DEFAULT_ALPHA } from './gpp-engine.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const noSemantic = args.includes('--no-semantic')
const alphaIdx = args.indexOf('--alpha')
const ALPHA = alphaIdx === -1 ? DEFAULT_ALPHA : Number(args[alphaIdx + 1])
const verbose = args.includes('--verbose')

const index = JSON.parse(readFileSync(path.join(ROOT, 'index.json'), 'utf8'))
const prep = prepareIndex(index)
const useSemantic = !noSemantic && prep.useSemantic

const QUERIES = [
  { q: '大量子弹频繁创建销毁，怎么避免 GC 压力和分配开销', expect: 'object-pool' },
  { q: '怪物有站立、追击、攻击等状态，怎么组织代码', expect: 'state' },
  { q: '生命值变化时 UI 要更新，怎么解耦', expect: 'observer' },
  { q: '键盘按键绑定要支持玩家自定义重映射', expect: 'command' },
  { q: '游戏循环怎么处理帧率波动，固定时间步还是可变时间步', expect: 'game-loop' },
  { q: '音频请求要延迟处理、排队播放', expect: 'event-queue' },
  { q: '不同系统之间怎么通信又不想耦合', expect: 'event-queue' },
  { q: '实体组件系统怎么设计', expect: 'component' },
  { q: '对象池', expect: 'object-pool' },
  { q: '状态机', expect: 'state' },
  { q: 'Unity 里怎么做对象池', expect: 'object-pool' },
  { q: 'how to avoid allocation overhead for projectiles', expect: 'object-pool' },
  { q: 'undo and redo input commands', expect: 'command' },
  { q: '很多相同对象的内存占用问题，比如森林里的树', expect: 'flyweight' },
  { q: '寻路结果缓存，地图变了才重新计算', expect: 'dirty-flag' },
]

async function main() {
  console.log(`index: ${index.chunks.length} chunks, semantic=${useSemantic}, alpha=${ALPHA}`)
  let hits1 = 0
  let hits3 = 0
  let total = 0
  let mrrSum = 0
  for (const { q, expect } of QUERIES) {
    const { hits } = await searchPrepared(prep, q, { alpha: ALPHA, topK: 5 })
    const ranks = hits.map((r) => r.chunk.pattern ?? r.chunk.chapter.replace('.markdown', ''))
    const rr = ranks.indexOf(expect) + 1
    const hit1 = ranks[0] === expect ? 1 : 0
    const hit3 = ranks.slice(0, 3).includes(expect) ? 1 : 0
    hits1 += hit1
    hits3 += hit3
    mrrSum += rr > 0 ? 1 / rr : 0
    total++
    console.log(`\nQ: ${q}\n  期望 ${expect} | hit@1=${hit1} hit@3=${hit3} | top:`)
    for (const r of hits.slice(0, 3)) {
      const label = `${r.chunk.pattern ?? '·'} ${r.chunk.chapterTitle} / ${r.chunk.section}`
      console.log(`    ${r.chunk.id}  bm25=${r.bm25.toFixed(2)} cos=${r.cos === null ? '—' : r.cos.toFixed(3)} score=${r.score.toFixed(3)}  ${label}`)
      if (verbose) console.log(`      ${r.chunk.text.slice(0, 120).replace(/\n/g, ' ')}...`)
    }
  }
  console.log(`\n=== hit@1: ${hits1}/${total} (${((hits1 / total) * 100).toFixed(0)}%) | hit@3: ${hits3}/${total} (${((hits3 / total) * 100).toFixed(0)}%) | MRR: ${(mrrSum / total).toFixed(3)} ===`)
}

main().catch((err) => {
  console.error('[eval] 失败：', err.stack ?? err)
  process.exit(1)
})
