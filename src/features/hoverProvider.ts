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

    // Priority 0: Active Editor Selection (if user highlighted text and cursor is within selection)
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor &&
      activeEditor.document.uri.toString() === document.uri.toString() &&
      !activeEditor.selection.isEmpty &&
      activeEditor.selection.contains(position)
    ) {
      const selectedText = document.getText(activeEditor.selection).trim();
      if (selectedText.length > 1) {
        targetText = selectedText;
        associatedSignature = CommentExtractor.findAssociatedSignature(
          document,
          activeEditor.selection.end.line
        );
      }
    }

    // Priority 1: Enclosing Comment Block or Multiline Docstring (//, #, /* */, """ """, ''' ''')
    if (!targetText) {
      const commentBlock = CommentExtractor.extractEnclosingComment(document, position);
      if (commentBlock && commentBlock.cleanText.length > 2) {
        targetText = commentBlock.cleanText;
        associatedSignature = commentBlock.associatedCodeSignature;
      }
    }

    // Priority 2: LSP Documentation (functions, builtins, types e.g. len)
    if (!targetText) {
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        if (word.length >= 2) {
          const lspDoc = await this.queryLspDocumentation(document, position);
          if (lspDoc && lspDoc.docText.length > 3) {
            targetText = lspDoc.docText;
            associatedSignature = lspDoc.signature || word;
          } else {
            // Priority 3: Check if cursor is inside a string literal ("...", '...', `...`)
            const stringLiteral = CommentExtractor.extractEnclosingString(document, position);
            if (stringLiteral && stringLiteral.length > 2) {
              targetText = stringLiteral;
            } else {
              // Priority 4: Check if current line has an inline comment
              const inlineComment = CommentExtractor.extractInlineComment(document, position.line);
              if (inlineComment && inlineComment.length > 2) {
                targetText = inlineComment;
              } else {
                targetText = word;
              }
            }
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

    const cachedLiteral = storage.get(targetText, config.targetLanguage, 'literal-accurate');
    const cachedExplain = storage.get(targetText, config.targetLanguage, config.explainStyle);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Coordinates to pass to command
    const basePayload = {
      text: targetText,
      uri: document.uri.toString(),
      position: { line: position.line, character: position.character },
      signature: associatedSignature,
    };

    if (cachedLiteral || cachedExplain) {
      md.appendMarkdown(`---\n### 💡 AnyComment 双语对照与技术解读\n\n`);

      if (cachedLiteral) {
        md.appendMarkdown(`#### 🌐 中文直译\n${cachedLiteral.translation}\n\n`);
      }
      if (cachedExplain) {
        md.appendMarkdown(`#### 💡 工程师通俗解读\n${cachedExplain.translation}\n\n`);
      }

      md.appendMarkdown(`---\n`);
      md.appendMarkdown(
        `[📖 打开代码内联透视 (方案 B 推荐)](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify(basePayload))}`)})  |  `
      );
      const refreshPayload = { ...basePayload, forceRefresh: true };
      md.appendMarkdown(
        `[🔄 重新生成](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify(refreshPayload))}`)})\n`
      );
    } else {
      md.appendMarkdown(`---\n`);
      md.appendMarkdown(
        `[📖 打开代码内联透视 (方案 B 推荐)](${vscode.Uri.parse(`command:anycomment.openPeek?${encodeURIComponent(JSON.stringify(basePayload))}`)})  |  `
      );
      const transPayload = { ...basePayload, forceTranslate: true };
      md.appendMarkdown(
        `[🌐 极速悬停直译](${vscode.Uri.parse(`command:anycomment.translateHover?${encodeURIComponent(JSON.stringify(transPayload))}`)})\n`
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
