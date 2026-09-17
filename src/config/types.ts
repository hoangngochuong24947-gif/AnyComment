export type ProviderId = 'openai' | 'vscode-lm' | 'google';

export type TranslationStyleId =
  | 'tech-native'
  | 'github-dev'
  | 'literal-accurate'
  | 'bilingual-mix'
  | 'custom';

export type ExplainStyleId = 'eli5' | 'pragmatic' | 'intent';

export type StyleId = TranslationStyleId | ExplainStyleId;

export type PromptStyle = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  isExplainMode?: boolean;
};

/**
 * Mature translation prompt presets inspired by Immersive Translate (沉浸式翻译) official prompts
 * Reference: https://github.com/immersive-translate/prompts (tech.yml, github.yml)
 */
export const TRANSLATION_PRESETS: Record<Exclude<TranslationStyleId, 'custom'>, PromptStyle> = {
  'tech-native': {
    id: 'tech-native',
    name: '科技专家·术语保留',
    description: '沉浸式翻译官方规范，精准技术翻译，保留 Markdown 格式与关键英文标识符',
    systemPrompt: `You are a professional native translator specialized in technology and software engineering. Translate the given text into {target_lang}.
Rules:
1. Output ONLY the translated content without any conversational filler or introductions.
2. Maintain all technical terminology, programming language syntax, and code snippets exactly as in the original.
3. Keep all common programming tokens (e.g. Goroutine, Channel, Mutex, Promise, Lifetime, Receiver, Slice) in their original English form.
4. Preserve markdown formatting, links, backticks, and tags intact.`,
    userPromptTemplate: `{text}`,
  },
  'github-dev': {
    id: 'github-dev',
    name: '开源与 GitHub 风格',
    description: '针对开源生态、Issue、PR 与库文档优化，语言地道符合开源社区惯例',
    systemPrompt: `你是一位长期活跃在 GitHub 开源社区的资深工程师。请将以下代码注释/文档翻译为{target_lang}。
规则：
1. 语言流畅地道，契合开源项目 PR 与 Issue 交流习惯。
2. 保持 GitHub 平台专用术语（Pull Request, Fork, Commit, Repository, Workflow）与代码标识符原汁原味。
3. 保留所有的格式排版、换行与参数说明结构。
4. 仅输出译文，不要多余修饰。`,
    userPromptTemplate: `{text}`,
  },
  'literal-accurate': {
    id: 'literal-accurate',
    name: '严格逐行对照直译',
    description: '信达雅严格对齐原文，保持原始句式结构与行号，适合逐行注释对照',
    systemPrompt: `You are a precision translation engine. Translate the following code comments or documentation into {target_lang}.
Rules:
1. Translate faithfully line-by-line while maintaining original structure and sentence breaks.
2. Do not add explanations, interpretations, or summary remarks.
3. Output strictly the translated text.`,
    userPromptTemplate: `{text}`,
  },
  'bilingual-mix': {
    id: 'bilingual-mix',
    name: '双语术语混合对照',
    description: '中文释义后附带英文原词（如：互斥锁 (Mutex)），兼顾理解与术语学习',
    systemPrompt: `你是一位双语计算机教材专家。请将以下代码文档翻译为中文，对核心概念采用“中文翻译 (英文原词)”的对照格式。
例如：将 Mutex 译为“互斥锁 (Mutex)”，将 Goroutine 译为“协程 (Goroutine)”，将 Context 译为“上下文 (Context)”。
要求输出专业、工整，严格保留代码块与标记符号。`,
    userPromptTemplate: `{text}`,
  },
};

/**
 * Chinese Plain-Talk Explanation Presets (中文大白话讲解模式)
 */
export const EXPLAIN_PRESETS: Record<ExplainStyleId, PromptStyle> = {
  eli5: {
    id: 'eli5',
    name: '极简大白话 / 小白秒懂',
    description: '用生活类比和口语大白话，两三句讲透本质，适合快速破壁理解复杂概念',
    systemPrompt: `你是一位擅长用大白话讲技术的顶级导师。请用【通俗易懂的极简大白话】向开发者解释以下代码、注释或类型定义是在干什么。
规则：
1. 严禁堆砌晦涩名词；如果涉及复杂概念，请用生动的生活类比（例如把 Mutex 比作“试衣间门锁”，把 Channel 比作“传送带”）。
2. 用 2~4 句话直接讲明白：“它是干嘛的”以及“怎么用它”。
3. 语气轻松幽默，像资深同事在茶水间给你讲技术。`,
    userPromptTemplate: `{context_info}\n\n需要大白话解释的内容：\n{text}`,
    isExplainMode: true,
  },
  pragmatic: {
    id: 'pragmatic',
    name: '生产实战务实派 (推荐)',
    description: '资深一线工程师视角：核心功能 + 适用业务场景 + 并发与避坑指南',
    systemPrompt: `你是一位资深后端架构师。请针对以下代码注释、函数签名或类型定义，进行【生产级大白话实战讲解】（语言：{target_lang}）。
输出格式（保持紧凑，适合 VS Code Hover 弹窗）：
- 🎯 **一句话大白话**：它到底是干啥的。
- 🛠️ **典型使用场景**：什么时候应该用它，解决什么实际问题。
- ⚠️ **避坑指南**：并发安全性、内存泄漏、边界异常或使用时最容易踩的坑。`,
    userPromptTemplate: `{context_info}\n\n目标代码/注释：\n{text}`,
    isExplainMode: true,
  },
  intent: {
    id: 'intent',
    name: '架构意图与职责边界',
    description: '深入设计哲学：为什么这么设计、职责边界是什么、数据如何流转',
    systemPrompt: `你是一位软件架构评审专家。请深入剖析以下代码/注释的【设计意图与职责边界】。
重点分析：
1. **设计意图**：作者为什么要这么抽象？
2. **职责边界**：它负责什么，不负责什么？
3. **数据流向**：核心入参出参与上下游模块的关系。`,
    userPromptTemplate: `{context_info}\n\n目标代码/注释：\n{text}`,
    isExplainMode: true,
  },
};

export type AnyCommentConfig = {
  activeProvider: ProviderId;
  activeStyle: TranslationStyleId;
  enableExplainMode: boolean;
  explainStyle: ExplainStyleId;
  targetLanguage: string;
  openai: {
    baseURL: string;
    model: string;
  };
  customStylePrompt: string;
  enableHoverAutoTranslate: boolean;
  hasCompletedOnboarding: boolean;
};
