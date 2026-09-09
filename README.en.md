English | [中文](README.md)

# dsh-gpp

A DeepSeek Harness game-programming assistant: turns Robert Nystrom's *Game Programming Patterns* into an on-demand local search tool. When making architecture or system design decisions, use `gpp_search` to query the book by engineering problem (in English or Chinese), with bilingual metadata for all 19 design patterns and Unity C# idiom mappings.

> ⚠️ This repository contains **none of the book's original text** (its prose is CC BY-NC-ND 4.0). It ships only self-authored code and metadata; you fetch the book locally and build the index yourself. See [License](#license).

## Features

- **Local hybrid search**: BM25 (bilingual keyword weighting) + bge-m3 semantic embeddings via Ollama, with automatic lexical fallback and a clear notice when Ollama is unavailable.
- **Structure-aware chunking**: split by chapter/section, code snippets inlined, each chunk tagged with its pattern, bilingual keywords, and related patterns.
- **Unity C# idiom mappings**: every pattern maps to concrete APIs/components (Observer→C# events, Object Pool→`UnityEngine.Pool`, Type Object→`ScriptableObject`, …).
- **Resident principles + on-demand skill**: a judgment framework while coding, plus original-text lookup when deciding.
- **Zero external dependencies**: the runtime uses only `node:` built-ins plus local Ollama HTTP — no separate vector database.

## Architecture

```
dsh-gpp/
├─ plugin/
│  ├─ gpp-search.js    # Tool plugin: registers gpp_search, hybrid search + fallback
│  └─ gpp-engine.mjs   # Search engine: tokenizer / BM25 / cosine / filters (zero deps)
├─ patterns.json       # Bilingual metadata + Unity idioms for all 19 patterns (self-authored)
├─ build.mjs           # Build script: chunking + metadata + bge-m3 embeddings → index.json
├─ eval.mjs            # Retrieval-quality harness (hit@1 / hit@3 / MRR)
├─ skill/
│  ├─ SKILL.md         # Skill: when to retrieve / how to query / rules / cheat sheet / Unity appendix
│  └─ gpp-principles.md# Resident persona principles
├─ README.md / README.en.md
└─ LICENSE
```

The index is a single JSON file loaded fully into memory at runtime — roughly 1.5 MB of text and 5 MB of vectors, with no external service.

## Prerequisites

- **Node.js ≥ 18** (build/eval only; the plugin itself runs inside the Harness process)
- **Ollama + `bge-m3`** (semantic search, optional; lexical fallback otherwise)

## Installation

1. Fetch the book locally (personal use; its prose is CC BY-NC-ND — do not redistribute the text):

   ```sh
   git clone --depth 1 https://github.com/munificent/game-programming-patterns book
   ```

2. Pull the embedding model and keep Ollama running:

   ```sh
   ollama pull bge-m3
   ```

3. Build the index:

   ```sh
   node build.mjs            # full: BM25 + bge-m3 vectors
   node build.mjs --no-embed # lexical only
   ```

4. Install into your DeepSeek Harness agent preset (`${DSH_HOME}/.agent-presets/<your-preset>/`):

   - `plugin/` → `<preset>/plugins/`
   - `skill/` → `<preset>/skills/game-programming-patterns/`
   - `patterns.json`, `index.json`, `book/` → `<preset>/gpp-data/`
   - Add a row to `<preset>/agent.cordis.yml`:

     ```yaml
     - id: tool-gpp-rag
       name: './plugins/gpp-search.js'
     ```

5. Restart DSH and start a session with that preset.

## Usage

- Call `gpp_search` before architecture decisions, and phrase the query as an engineering problem:
  - Good: `how to avoid GC pressure when creating and destroying lots of projectiles`
  - Weak: `Object Pool` (unless you want that pattern's exact text)
- Filter with `pattern` / `category`, and set `topK` (default 5, max 10).
- After a hit, read the full chapter from the locally packed text (`gpp-data/book/book/`).

## Retrieval quality

On a 15-query Chinese benchmark (pattern names, engineering problems, English queries):

- Hybrid (α=0.55): hit@1 ≈ 93%, hit@3 = 100%, MRR 0.967
- Lexical-only fallback: identical (the corpus is term-dense, so the lexical layer is already strong)

Re-run with `node eval.mjs [--alpha <0–1>] [--no-semantic]`.

## License

- **This repository's code and self-authored metadata** (plugin / build / eval / patterns.json / skill): MIT License, see `LICENSE`.
- ***Game Programming Patterns* prose**: CC BY-NC-ND 4.0, © Robert Nystrom. This repository distributes **no original text**; fetch it from <https://github.com/munificent/game-programming-patterns> for personal local use only, and do not redistribute or publish modified text.
- **Code samples in the book**: MIT License (© Robert Nystrom).
- The 19 patterns themselves are ideas, not copyrightable expression; this repository's cheat sheet, summaries, and Unity mappings are original commentary.

## Acknowledgements

Robert Nystrom's *Game Programming Patterns* — an open, clear, practical classic, and his openness in making it widely available.
