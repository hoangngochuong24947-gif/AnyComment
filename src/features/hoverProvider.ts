import * as vscode from 'vscode';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { CommentExtractor } from '../parser/commentExtractor.js';

/**
 * AnyComment Hover Provider
 * Supports multi-line comment block aggregation, LSP hover interception, and in-place refresh.
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#languages.registerHoverProvider
 */
export class AnyCommentHoverProvider implements vscode.HoverProvider {
  // Re-entrancy guard to prevent infinite recursion when calling vscode.executeHoverProvider
  private static isExecutingLsp = false;

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // If this call was triggered by our own LSP interception, return immediately
    if (AnyCommentHoverProvider.isExecutingLsp) {
      return undefined;
    }

    let targetText = '';
    let associatedSignature: string | undefined;

    // 1. Check if cursor is on an enclosing comment block (multi-line //, #, or /* ... */)
    const commentBlock = CommentExtractor.extractEnclosingComment(document, position);
    if (commentBlock && commentBlock.cleanText.length > 2) {
      targetText = commentBlock.cleanText;
      associatedSignature = commentBlock.associatedCodeSignature;
    } else {
      // 2. Not on a comment. Intercept LSP Hover documentation (e.g. for len, http.ListenAndServe)
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        if (word.length >= 2) {
          const lspDoc = await this.queryLspDocumentation(document, position);
          if (lspDoc && lspDoc.docText.length > 3) {
            targetText = lspDoc.docText;
            associatedSignature = lspDoc.signature || word;
          } else {
            // Fallback to word only if no LSP docs available
            targetText = word;
            associatedSignature = CommentExtractor.findAssociatedSignature(document, position.line);
          }
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

    // Coordinates to pass to command for in-place re-display via editor.action.showHover
    const basePayload = {
      text: targetText,
      uri: document.uri.toString(),
      position: { line: position.line, character: position.character },
      signature: associatedSignature,
    };

    if (cached) {
      const isExplain = config.enableExplainMode;
      const titleBadge = isExplain
        ? `💡 AnyComment 大白话讲解 [${config.explainStyle}]`
        : cached.partition === 'custom'
        ? `🎨 AnyComment [${config.activeStyle}]`
        : cached.source === 'seed'
        ? '📦 官方标准库预置'
        : '🌐 标准基线';

      // Clean display without destructive blockquote '>' so multi-line code/lists render cleanly
      md.appendMarkdown(`---\n### ${titleBadge}\n\n${cached.translation}\n\n---\n`);

      // In-place action links
      if (isExplain) {
        const transPayload = { ...basePayload, forceTranslate: true };
        md.appendMarkdown(
          `[🌐 切换并查看客观直译](${vscode.Uri.parse(`command:anycomment.translateHover?${encodeURIComponent(JSON.stringify(transPayload))}`)})  |  `
        );
      } else {
        const explainPayload = { ...basePayload, forceExplain: true };
        md.appendMarkdown(
          `[💡 大白话讲讲这个](${vscode.Uri.parse(`command:anycomment.translateHover?${encodeURIComponent(JSON.stringify(explainPayload))}`)})  |  `
        );
      }

      const refreshPayload = { ...basePayload, forceRefresh: true };
      md.appendMarkdown(
        `[🔄 重新生成](${vscode.Uri.parse(`command:anycomment.translateHover?${encodeURIComponent(JSON.stringify(refreshPayload))}`)})  |  `
      );

      // Open in Peek Drawer (Variant C)
      md.appendMarkdown(
        `[📖 行间透视抽屉 (Peek)](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify(basePayload))}`)})\n`
      );
    } else {
      const transPayload = { ...basePayload, forceTranslate: true };
      const explainPayload = { ...basePayload, forceExplain: true };

      md.appendMarkdown(`---\n`);
      md.appendMarkdown(
        `[💡 大白话抽屉 (推荐)](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify({ ...basePayload, forceExplain: true }))}`)})  |  `
      );
      md.appendMarkdown(
        `[🌐 翻译抽屉](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify({ ...basePayload, forceTranslate: true }))}`)})  |  `
      );
      md.appendMarkdown(
        `[悬停卡片直译](${vscode.Uri.parse(`command:anycomment.translateHover?${encodeURIComponent(JSON.stringify(transPayload))}`)})\n`
      );
    }

    return new vscode.Hover(md);
  }

  /**
   * Safely queries LSP for hover documentation with re-entrancy protection
   */
  private async queryLspDocumentation(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<{ signature?: string; docText: string } | undefined> {
    AnyCommentHoverProvider.isExecutingLsp = true;
    try {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        position
      );

      if (!hovers || hovers.length === 0) {
        return undefined;
      }

      const docParts: string[] = [];
      let signature: string | undefined;

      for (const hover of hovers) {
        for (const item of hover.contents) {
          const content = typeof item === 'string' ? item : item.value;
          if (!content) continue;

          // Check if item contains a fenced code block with the signature
          const codeFenceMatch = content.match(/^```[\w-]*\n([\s\S]*?)\n```/);
          if (codeFenceMatch && !signature) {
            signature = codeFenceMatch[1]?.trim();
            const rest = content.replace(codeFenceMatch[0], '').trim();
            if (rest) docParts.push(rest);
          } else {
            const trimmed = content.trim();
            if (trimmed) docParts.push(trimmed);
          }
        }
      }

      const docText = docParts.join('\n\n').trim();
      if (!docText) return undefined;

      return { signature, docText };
    } catch (err: unknown) {
      console.warn('[AnyComment] LSP query failed:', err);
      return undefined;
    } finally {
      AnyCommentHoverProvider.isExecutingLsp = false;
    }
  }
}
