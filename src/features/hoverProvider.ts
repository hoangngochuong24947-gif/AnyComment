import * as vscode from 'vscode';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { CommentExtractor } from '../parser/commentExtractor.js';

/**
 * AnyComment Hover Provider
 * Intercepts comments and symbols to append cached translations or translate action links.
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#languages.registerHoverProvider
 */
export class AnyCommentHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // 1. Identify comment on current line
    const slashIdx = lineText.indexOf('//');
    const hashIdx = lineText.indexOf('#');
    let targetText = '';

    if (slashIdx !== -1 && position.character >= slashIdx) {
      targetText = CommentExtractor.cleanCommentText(lineText.slice(slashIdx));
    } else if (hashIdx !== -1 && position.character >= hashIdx) {
      targetText = CommentExtractor.cleanCommentText(lineText.slice(hashIdx));
    } else {
      // If cursor is not on a comment, check word/selection
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        // Only consider meaningful identifier words (> 3 chars)
        if (word.length >= 3) {
          targetText = word;
        }
      }
    }

    if (!targetText || targetText.length < 2) {
      return undefined;
    }

    const config = ConfigManager.getInstance().getConfig();
    const storage = StorageManager.getInstance();
    const cached = storage.get(targetText, config.targetLanguage, config.activeStyle);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    if (cached) {
      const badge = cached.partition === 'custom'
        ? `🎨 AI风格 [${cached.styleId ?? config.activeStyle}]`
        : cached.source === 'seed'
        ? '📦 官方标准库预置'
        : '🌐 标准基线';

      md.appendMarkdown(`---\n### 📖 AnyComment (${badge})\n\n> ${cached.translation}\n\n`);

      if (cached.isFallback) {
        // If falling back to standard, offer to generate with the active custom style
        const cmdArgs = encodeURIComponent(JSON.stringify({ text: targetText, forceCustom: true }));
        md.appendMarkdown(`[✨ 生成当前风格解读](${vscode.Uri.parse(`command:anycomment.translateHover?${cmdArgs}`)}) `);
      }

      const retranslateArgs = encodeURIComponent(JSON.stringify({ text: targetText, forceRefresh: true }));
      md.appendMarkdown(`[🔄 重新翻译](${vscode.Uri.parse(`command:anycomment.translateHover?${retranslateArgs}`)})\n`);
    } else {
      const cmdArgs = encodeURIComponent(JSON.stringify({ text: targetText }));
      md.appendMarkdown(`---\n[🌐 AnyComment: 翻译/解读此内容](${vscode.Uri.parse(`command:anycomment.translateHover?${cmdArgs}`)})\n`);
    }

    return new vscode.Hover(md);
  }
}
