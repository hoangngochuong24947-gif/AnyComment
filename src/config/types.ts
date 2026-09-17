export type ProviderId = 'openai' | 'vscode-lm' | 'google';

export type StyleId = 'tech-plain' | 'literal' | 'deep-dive' | 'custom';

export interface PromptStyle {
  id: StyleId;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
}

export const PRESET_STYLES: Record<Exclude<StyleId, 'custom'>, PromptStyle> = {
  'tech-plain': {
    id: 'tech-plain',
    name: '通俗技术化 (保留术语)',
    description: '保留专业技术术语（如 Goroutine, Mutex, Promise），语言通俗精准',
    systemPrompt: `你是一位资深架构师和编程技术专家。请将用户给出的代码注释或函数文档翻译为{target_lang}。
规则：
1. 保持专业与严谨，语言精炼通俗。
2. 常见编程专有名词及类型名（如 Goroutine, Channel, Mutex, Promise, Lifetime, Pointer, Receiver 等）保留英文原词。
3. 严格保留 Markdown 标记、代码块、参数名和特殊符号格式。
4. 仅输出翻译后的内容，不要添加“以下是翻译：”等任何客套话。`,
    userPromptTemplate: `{text}`,
  },
  literal: {
    id: 'literal',
    name: '精确直译 (保持格式)',
    description: '严格按照原文逐句对照直译，保持原始排版与句式',
    systemPrompt: `You are a professional technical translator. Translate the following code comments or documentation into {target_lang}.
Rules:
1. Translate faithfully and accurately line-by-line.
2. Keep code identifiers, markdown links, tags, and formatting verbatim.
3. Output ONLY the translated content without any conversational filler.`,
    userPromptTemplate: `{text}`,
  },
  'deep-dive': {
    id: 'deep-dive',
    name: 'API 深度解析 (含避坑指南)',
    description: '提供核心功能释义、参数要点及生产环境易错点/并发避坑提示',
    systemPrompt: `你是一位资深技术布道师。请针对以下函数文档进行技术翻译与深度解析（目标语言：{target_lang}）。
输出格式：
- **【核心概述】**：用一两句大白话讲清楚这个函数/类型是干什么的。
- **【参数与返回值】**：关键入参与返回值的技术要点。
- **【避坑指南】**：并发安全、内存释放、边界条件或使用时的常见陷阱。
输出需保持紧凑，适合在 VS Code Hover 弹窗或侧边栏中快速阅读。`,
    userPromptTemplate: `{text}`,
  },
};

export interface AnyCommentConfig {
  activeProvider: ProviderId;
  activeStyle: StyleId;
  targetLanguage: string;
  openai: {
    baseURL: string;
    model: string;
  };
  customStylePrompt: string;
  enableHoverAutoTranslate: boolean;
}
