---
name: game-programming-patterns
description: >
  Consult Robert Nystrom's Game Programming Patterns (local RAG + Unity C#
  mapping) when designing or changing game architecture, gameplay systems,
  state management, event communication, update loops, object lifetime,
  memory management, data layout, or performance-sensitive game code.
---

# Game Programming Patterns（游戏编程模式）

Robert Nystrom 的《Game Programming Patterns》是游戏软件架构的经典之作。本技能配套：

- **`gpp_search` 工具**：全书本地混合检索（337 个结构切块 + 中英双语元数据 + BM25 + bge-m3 语义层，Ollama 不可用时自动降级纯词汇）；
- 本文件的**模式速查表**与**Unity C# 惯用法附录**；
- 书全文 markdown 本地打包（随索引同目录），可用内置 read 工具直读原文。

## 何时检索

在做出重要架构决策**之前**检索，涉及：

- 任意一个模式：Command / Flyweight / Observer / Prototype / Singleton / State / Double Buffer / Game Loop / Update Method / Bytecode / Subclass Sandbox / Type Object / Component / Event Queue / Service Locator / Data Locality / Dirty Flag / Object Pool / Spatial Partition；
- 或代码库表现出：紧耦合、复杂状态切换、频繁分配与 GC 压力、缓存不友好的数据布局、事件传播时序问题、更新顺序问题、对象生命周期混乱、实体组合困难、空间邻近查询变慢。

## 如何检索

用 `gpp_search`，把**工程问题**写成查询（中英文均可）：

- 好：「大量子弹频繁创建销毁，怎么避免 GC 压力」「生命值变化时 UI 要更新，怎么解耦」
- 不好：「Object Pool」——除非你就是要查这个模式的原文。

- 架构决策横跨多个模式时，多查几次、去掉过滤条件。
- 可用 `pattern` / `category` 参数过滤（slug 或中英文名均可）。
- 命中后需要完整上下文时，用 read 工具读取工具返回的 `bookDir` 下对应章节（全书全文已本地打包）。
- 工具结果标注了检索形态：Ollama 未运行时为纯词汇检索，语义相关但用词不同的内容可能漏掉，此时多换几种说法重查。

## 使用纪律

1. 推荐模式前先检索，以检索到的原文为准，不用记忆里的二手转述。
2. 不为了用模式而用模式；先确认它解决眼前的问题。
3. 评估代价：每个模式都有权衡（见速查表的"何时不用"列）。
4. 优先最简单的设计；项目约束、正确性、可维护性与实测性能优先于模式本身。
5. 应用模式时讲清五要素：观察到的问题 → 对应模式 → 为何契合 → 代价 → 具体代码改动。
6. Unity 项目优先参考本文件附录的引擎惯用法；引擎自带能力（Animator 状态机、Physics 空间查询、Prefab、内建池）优先于手写实现。

## 19 模式速查

| 模式 | 一句话意图 | 何时不用 |
|---|---|---|
| Command 命令模式 | 把方法调用封装成对象，可排队、记录、撤销、重映射 | 简单回调即可；无排队/撤销/重映射需求 |
| Flyweight 享元模式 | 共享数据外提为单一实例，省内存 | 对象独立状态多、共享态会变；内存压力不明显 |
| Observer 观察者模式 | 发布通知、订阅解耦 | 通知时序难推理、订阅关系复杂时考虑事件队列；务必退订 |
| Prototype 原型模式 | 克隆现有对象代替从头构造 | 类型少、构造简单时直接 new；深拷贝语义复杂时慎用 |
| Singleton 单例模式 | 唯一实例 + 全局访问（书中态度：慎用） | 优先依赖注入；测试难、隐藏依赖时坚决不用 |
| State 状态模式 | 随状态切换行为，消除条件分支 | 状态少且稳定时枚举 + switch 更简单 |
| Double Buffer 双缓冲 | 完整帧渲染后一次性呈现 | 仅需原子呈现/避免中间态时才需要；引擎已内建 |
| Game Loop 游戏循环 | 输入→更新→渲染循环，处理时间步 | 用引擎时不必自写；自写主循环时才参考 |
| Update Method 更新方法 | 每帧调用对象更新方法 | 少量对象用引擎自带 Update；海量对象才批量管理 |
| Bytecode 字节码 | 行为编码成指令，数据化/可编辑 | 行为不需数据化/热更时，硬编码更快 |
| Subclass Sandbox 子类沙盒 | 基类保护操作集内实现子类行为 | 基类易膨胀成上帝类；差异小时直接写方法 |
| Type Object 类型对象 | 数据对象表示类型，避免类爆炸 | 类型少且稳定时普通类更直接 |
| Component 组件模式 | 实体聚合组件，替代深继承 | 小项目过度拆分徒增复杂度；组件间通信要有纪律 |
| Event Queue 事件队列 | 队列缓冲延迟分发，解耦双方 | 需要即时响应时不用（延迟是特性也是代价） |
| Service Locator 服务定位器 | 全局注册表按需提供服务 | 显式注入更清晰，优先 DI；只留给横切服务 |
| Data Locality 数据局部性 | 按访问顺序排布内存，吃满缓存 | 先 Profile 再优化；改动成本高，收益要实测 |
| Dirty Flag 脏标记 | 改动置脏、需要时才重算 | 计算本身便宜时缓存是负收益；脏传播复杂易漏置 |
| Object Pool 对象池 | 复用对象避免分配/GC 开销 | 先 Profile 确认分配是瓶颈；池引入生命周期复杂度 |
| Spatial Partition 空间分区 | 按空间分区存储，加速邻近查询 | 对象少/分布均匀时线性遍历足够；动态移动多则维护成本高 |

## Unity 惯用法附录

| 模式 | Unity (C#) 惯用法 |
|---|---|
| Command | Input System Action 触发 Command 对象；输入录制回放 = 命令流；撤销/重做栈；命令对象排队做技能连招 |
| Flyweight | 共享 Mesh/Material 资产；GPU Instancing + MaterialPropertyBlock 只变每实例数据；ScriptableObject 存共享配置 |
| Observer | C# event / UnityEvent；ScriptableObject GameEvent 通道；OnDestroy/OnDisable 退订避免悬空引用 |
| Prototype | Prefab + Instantiate 即该模式；ScriptableObject 做原型数据；变体 Prefab 实现原型链；克隆后重置状态 |
| Singleton | 少用 MonoBehaviour 单例；ScriptableObject 单例资产或 DI（Zenject/VContainer）绑定；静态类只做纯函数 |
| State | Animator 管动画态；逻辑态用手写 FSM（枚举 + 字典或状态类）；ScriptableObject 状态做数据驱动状态机 |
| Double Buffer | 引擎渲染已内建；自定义用 RenderTexture ping-pong 或 CommandBuffer |
| Game Loop | Update（可变步长）/ FixedUpdate（固定物理步长）/ LateUpdate（跟随相机）；Time.deltaTime / fixedDeltaTime / unscaledDeltaTime |
| Update Method | MonoBehaviour.Update 即该模式；海量对象用自建 UpdateManager 批量手动更新 |
| Bytecode | 数据驱动技能/剧情：ScriptableObject + 小指令解释器，或行为树/节点图插件；避免硬编码魔法系统 |
| Subclass Sandbox | 自定义 MonoBehaviour 基类提供 protected 辅助方法；警惕基类膨胀 |
| Type Object | ScriptableObject 定义怪物种类/武器类型等数据；替代"每种敌人一个子类" |
| Component | GameObject + Component 即该模式；优先组合；GetComponent 结果缓存；跨组件通信用事件/接口 |
| Event Queue | 主线程安全队列（ConcurrentQueue/Channel）+ Update/协程泵；后台线程结果回调主线程；音频指令排队 |
| Service Locator | 静态服务注册表；现代项目优先 DI 显式注入；仅音频/日志等横切服务保留定位器 |
| Data Locality | DOTS/ECS + NativeArray + Burst/Job System；热数据用紧凑 struct 数组（SoA）；避免每帧分配 |
| Dirty Flag | UI Canvas 重建即该思想；Transform 层级脏传播；自建「世界矩阵/寻路图缓存」时用脏标记延迟重算 |
| Object Pool | 预实例化池（UnityEngine.Pool / 自写池组件）；子弹/特效/敌人复用；归还时重置状态；粒子用引擎内置池 |
| Spatial Partition | Physics 查询（OverlapSphere/Raycast）内置空间结构；非物理用途自建 Grid/四叉树 |

## 数据与版权

- 索引与全文由 `build.mjs` 在你本地从上游原书仓库构建，落在预设目录 `gpp-data/`（`index.json` + `book/`）；插件源码位于 `plugins/`。本仓库本身不分发任何原书文本。
- 书原文版权：正文 CC BY-NC-ND 4.0、代码示例 MIT（Robert Nystrom）。**仅限本地个人使用**，不要公开分发改写后的文本。
- 语义检索需要 Ollama 服务在运行且已拉取 `bge-m3`；未运行时工具自动降级纯词汇并在结果中标注。
