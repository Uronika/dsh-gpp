[English](README.en.md) | 中文

# dsh-gpp

DeepSeek Harness 游戏程序设计助手：把 Robert Nystrom《Game Programming Patterns》变成随手的本地检索工具。做游戏架构 / 系统设计决策时，用 `gpp_search` 以工程问题（中英文皆可）检索书中对应章节，并获得 19 个设计模式的中英双语元数据与 Unity C# 惯用法映射。

> ⚠️ 本仓库**不包含《Game Programming Patterns》的任何原文文本**（其正文为 CC BY-NC-ND 4.0）。这里只有自研代码与元数据；书的内容由你在本地自行获取并构建索引。详见下方「版权」。

## 特性

- **本地混合检索**：BM25（双语关键词加权）+ bge-m3 语义（经 Ollama），Ollama 不可用时自动降级纯词汇并在结果中明确标注
- **结构感知切块**：按章节 / 小节切分，代码段内联，每块附模式归属、中英双语关键词与关联模式
- **Unity C# 惯用法映射**：19 个模式各对应到具体 API / 组件（Observer→C# event、Object Pool→UnityEngine.Pool、Type Object→ScriptableObject 等）
- **常驻原则 + 按需 skill**：编码时带着判断框架，做决策时查原文
- **零外部依赖**：运行时仅 `node:` 内置模块 + 本地 Ollama HTTP，无独立向量库

## 架构

```
dsh-gpp/
├─ plugin/
│  ├─ gpp-search.js    # 工具插件：注册 gpp_search，混合检索 + 降级兜底
│  └─ gpp-engine.mjs   # 检索引擎：分词 / BM25 / 余弦 / 过滤（零依赖）
├─ patterns.json       # 19 模式双语元数据 + Unity 惯用法（自研原创）
├─ build.mjs           # 构建脚本：切块 + 元数据 + bge-m3 嵌入 → index.json
├─ eval.mjs            # 检索质量验收脚本（中文问题集 hit@1/hit@3/MRR）
├─ skill/
│  ├─ SKILL.md         # 技能指令：何时检索 / 检索方法 / 使用纪律 / 速查表 / Unity 附录
│  └─ gpp-principles.md# 常驻 persona 原则文本
├─ README.md
└─ LICENSE
```

索引是一个 JSON 文件，运行时全量加载进内存；书全文约 1.5MB、向量约 5MB，**零外部服务**。

## 前置依赖

- **Node.js ≥ 18**（仅构建 / 验收用；运行时不依赖 Node 本体，因为插件跑在 Harness 进程内）
- **Ollama + `bge-m3`**（语义检索用，可选；缺失时自动降级纯词汇）

## 安装

1. 在本地获取原书（个人使用；书正文为 CC BY-NC-ND，**勿对外分发文本**）：

   ```sh
   git clone --depth 1 https://github.com/munificent/game-programming-patterns book
   ```

2. 拉取 embedding 模型并确保 Ollama 服务在运行：

   ```sh
   ollama pull bge-m3
   ```

3. 构建索引：

   ```sh
   node build.mjs            # 完整构建（BM25 + bge-m3 向量）
   node build.mjs --no-embed # 或只建词汇索引
   ```

4. 装入你的 DeepSeek Harness agent 预设（`${DSH_HOME}/.agent-presets/<你的预设>/`）：

   - `plugin/` → `<预设>/plugins/`
   - `skill/` → `<预设>/skills/game-programming-patterns/`
   - `patterns.json`、`index.json`、`book/` → `<预设>/gpp-data/`
   - 在 `<预设>/agent.cordis.yml` 中新增一行：

     ```yaml
     - id: tool-gpp-rag
       name: './plugins/gpp-search.js'
     ```

5. 重启 DSH，用该预设开会话。

## 使用

- 做架构决策前调用 `gpp_search`，**面向问题**构造查询：
  - 好：`大量子弹频繁创建销毁怎么避免 GC 压力`
  - 不好：`Object Pool`（除非就是要查该模式原文）
- 用 `pattern` / `category` 参数过滤，`topK` 控制条数（默认 5，最大 10）。
- 命中后可用内置 `read` 直接读本地打包的章节全文（`gpp-data/book/book/`）。

## 检索质量

中文问题集（15 条，覆盖模式名、工程问题、英文查询）：

- 混合检索（α=0.55）：hit@1 ≈ 93%，hit@3 = 100%，MRR 0.967
- 纯词汇降级：与上一致（该语料术语密集，词汇层已很强）

用 `node eval.mjs [--alpha <0~1>] [--no-semantic]` 复评。

## 版权

- **本仓库的代码与自研元数据（plugin / build / eval / patterns.json / skill）**：MIT License，见 `LICENSE`。
- **《Game Programming Patterns》正文**：CC BY-NC-ND 4.0，版权归 Robert Nystrom。本仓库**不分发任何原文**；请通过上游仓库 <https://github.com/munificent/game-programming-patterns> 在本地获取，仅限个人使用，勿对外分发或改写传播文本。
- **书内代码示例**：MIT License（版权归 Robert Nystrom）。
- 19 个设计模式本身是思想，不受版权保护；本仓库的速查表、概括与 Unity 映射均为自研原创评论。

## 致谢

Robert Nystrom 的《Game Programming Patterns》——一本开放、清晰、务实的经典，以及他对"让更多人用得上"的开放态度。
