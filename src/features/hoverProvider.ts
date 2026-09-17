import * as vscode from 'vscode';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { CommentExtractor } from '../parser/commentExtractor.js';

/**
 * AnyComment Hover Provider
 * Supports both standard technical translation and Chinese plain-talk explanation.
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

    // 1. Identify comment on current line or symbol
    const slashIdx = lineText.indexOf('//');
    const hashIdx = lineText.indexOf('#');
    let targetText = '';
    let associatedSignature: string | undefined;

    if (slashIdx !== -1 && position.character >= slashIdx) {
      targetText = CommentExtractor.cleanCommentText(lineText.slice(slashIdx));
      associatedSignature = CommentExtractor.findAssociatedSignature(document, position.line);
    } else if (hashIdx !== -1 && position.character >= hashIdx) {
      targetText = CommentExtractor.cleanCommentText(lineText.slice(hashIdx));
      associatedSignature = CommentExtractor.findAssociatedSignature(document, position.line);
    } else {
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        if (word.length >= 3) {
          targetText = word;
          associatedSignature = CommentExtractor.findAssociatedSignature(document, position.line);
        }
      }
    }

    if (!targetText || targetText.length < 2) {
      return undefined;
    }

    const config = ConfigManager.getInstance().getConfig();
    const storage = StorageManager.getInstance();
    const activeStyleId = config.enableExplainMode ? config.explainStyle : config.activeStyle;
    const cached = storage.get(targetText, config.targetLanguage, activeStyleId);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    if (cached) {
      const isExplain = config.enableExplainMode;
      const titleBadge = isExplain
        ? `💡 AnyComment 大白话讲解 [${config.explainStyle}]`
        : cached.partition === 'custom'
        ? `🎨 AnyComment [${config.activeStyle}]`
        : cached.source === 'seed'
        ? '📦 官方标准库预置'
        : '🌐 标准基线';

      md.appendMarkdown(`---\n### ${titleBadge}\n\n> ${cached.translation}\n\n`);

      // Bidirectional action links
      if (isExplain) {
        const transArgs = encodeURIComponent(JSON.stringify({ text: targetText, forceTranslate: true }));
        md.appendMarkdown(`[🌐 查看客观直译](${vscode.Uri.parse(`command:anycomment.translateHover?${transArgs}`)})  `);
      } else {
        const explainArgs = encodeURIComponent(
          JSON.stringify({ text: targetText, forceExplain: true, signature: associatedSignature })
        );
        md.appendMarkdown(`[💡 大白话讲讲这个](${vscode.Uri.parse(`command:anycomment.translateHover?${explainArgs}`)})  `);
      }

      const refreshArgs = encodeURIComponent(
        JSON.stringify({ text: targetText, forceRefresh: true, signature: associatedSignature })
      );
      md.appendMarkdown(`[🔄 重新生成](${vscode.Uri.parse(`command:anycomment.translateHover?${refreshArgs}`)})\n`);
    } else {
      const transArgs = encodeURIComponent(JSON.stringify({ text: targetText, signature: associatedSignature }));
      const explainArgs = encodeURIComponent(
        JSON.stringify({ text: targetText, forceExplain: true, signature: associatedSignature })
      );

      md.appendMarkdown(`---\n`);
      md.appendMarkdown(`[🌐 翻译此内容](${vscode.Uri.parse(`command:anycomment.translateHover?${transArgs}`)})  |  `);
      md.appendMarkdown(`[💡 大白话讲解](${vscode.Uri.parse(`command:anycomment.translateHover?${explainArgs}`)})\n`);
    }

    return new vscode.Hover(md);
  }
}
