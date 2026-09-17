import * as vscode from 'vscode';

export type ExtractedComment = {
  range: vscode.Range;
  cleanText: string;
  rawText: string;
  isBlock: boolean;
  associatedCodeSignature?: string;
};

/**
 * Ultra-lightweight comment and code signature extractor.
 * Zero external dependencies, pure regex and line scanning (<1ms).
 */
export class CommentExtractor {
  /**
   * Cleans comment prefixes while preserving paragraphs and line formatting.
   */
  public static cleanCommentText(rawText: string): string {
    const lines = rawText.split('\n').map((line) => {
      let cleaned = line.trim();
      // Remove // or ///
      cleaned = cleaned.replace(/^\/\/\/?\s?/, '');
      // Remove block comment markers /*, /**, */
      cleaned = cleaned.replace(/^\/\*\*?\s?/, '');
      cleaned = cleaned.replace(/\*\/$/, '');
      // Remove leading * in JSDoc/GoDoc blocks
      cleaned = cleaned.replace(/^\*\s?/, '');
      // Remove python/shell #
      cleaned = cleaned.replace(/^#\s?/, '');
      // Remove python triple quotes
      cleaned = cleaned.replace(/^"""\s?/, '').replace(/"""$/, '');
      return cleaned;
    });

    // Remove empty lines at beginning and end, preserve paragraphs in between
    while (lines.length > 0 && lines[0]?.trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
      lines.pop();
    }

    return lines.join('\n').trim();
  }

  /**
   * Extracts the full contiguous enclosing comment block at cursor position.
   * Handles multi-line // or # blocks, and multiline /* ... *\/ blocks.
   */
  public static extractEnclosingComment(
    document: vscode.TextDocument,
    position: vscode.Position
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    const currentLine = document.lineAt(lineIndex).text;
    const langId = document.languageId;
    const lineCommentPrefix =
      langId === 'python' || langId === 'shellscript' || langId === 'dockerfile' ? '#' : '//';

    // 1. Check if cursor is on a line comment (// or #)
    const prefixIdx = currentLine.indexOf(lineCommentPrefix);
    if (prefixIdx !== -1 && position.character >= prefixIdx) {
      let startLine = lineIndex;
      let endLine = lineIndex;

      // Scan upwards for contiguous single-line comments
      while (startLine > 0) {
        const prevText = document.lineAt(startLine - 1).text;
        const prevIdx = prevText.indexOf(lineCommentPrefix);
        if (prevIdx === -1) break;
        // Verify previous line only has comment or same prefix indentation
        startLine--;
      }

      // Scan downwards for contiguous single-line comments
      while (endLine < document.lineCount - 1) {
        const nextText = document.lineAt(endLine + 1).text;
        const nextIdx = nextText.indexOf(lineCommentPrefix);
        if (nextIdx === -1) break;
        endLine++;
      }

      const rawLines: string[] = [];
      for (let i = startLine; i <= endLine; i++) {
        const txt = document.lineAt(i).text;
        const idx = txt.indexOf(lineCommentPrefix);
        rawLines.push(txt.slice(idx));
      }

      const rawText = rawLines.join('\n');
      const cleanText = this.cleanCommentText(rawText);
      const startCol = document.lineAt(startLine).text.indexOf(lineCommentPrefix);
      const endCol = document.lineAt(endLine).text.length;

      const range = new vscode.Range(
        new vscode.Position(startLine, startCol),
        new vscode.Position(endLine, endCol)
      );

      const associatedCodeSignature = this.findAssociatedSignature(document, endLine);

      return {
        range,
        cleanText,
        rawText,
        isBlock: false,
        associatedCodeSignature,
      };
    }

    // 2. Check if cursor is inside a block comment (/* ... */)
    // Scan upwards to find the opening /*
    let blockStartLine = -1;
    let blockStartCol = -1;

    for (let i = lineIndex; i >= Math.max(0, lineIndex - 100); i--) {
      const text = document.lineAt(i).text;
      const startIdx = text.lastIndexOf('/*');
      const endIdx = text.lastIndexOf('*/');

      if (startIdx !== -1 && (endIdx === -1 || startIdx > endIdx)) {
        blockStartLine = i;
        blockStartCol = startIdx;
        break;
      }
      if (endIdx !== -1 && i < lineIndex) {
        // Reached previous block's end, no unclosed block above
        break;
      }
    }

    if (blockStartLine !== -1) {
      // Scan downwards to find the closing */
      let blockEndLine = -1;
      let blockEndCol = -1;

      for (let i = lineIndex; i < Math.min(document.lineCount, lineIndex + 100); i++) {
        const text = document.lineAt(i).text;
        const endIdx = text.indexOf('*/');
        if (endIdx !== -1) {
          blockEndLine = i;
          blockEndCol = endIdx + 2;
          break;
        }
      }

      if (blockEndLine !== -1) {
        const range = new vscode.Range(
          new vscode.Position(blockStartLine, blockStartCol),
          new vscode.Position(blockEndLine, blockEndCol)
        );
        const rawText = document.getText(range);
        const cleanText = this.cleanCommentText(rawText);
        const associatedCodeSignature = this.findAssociatedSignature(document, blockEndLine);

        return {
          range,
          cleanText,
          rawText,
          isBlock: true,
          associatedCodeSignature,
        };
      }
    }

    return undefined;
  }

  /**
   * Ultra-lightweight lookahead: inspects 1~4 lines below the comment to grab the code signature.
   */
  public static findAssociatedSignature(document: vscode.TextDocument, endLineIndex: number): string | undefined {
    const maxScanLines = Math.min(document.lineCount, endLineIndex + 5);

    for (let i = endLineIndex + 1; i < maxScanLines; i++) {
      const lineText = document.lineAt(i).text.trim();
      if (!lineText) continue;

      // Stop if hitting another comment line
      if (lineText.startsWith('//') || lineText.startsWith('#') || lineText.startsWith('/*')) {
        break;
      }

      // Check common function/type signatures
      const signatureRegex =
        /^(export\s+)?(default\s+)?(async\s+)?(func|def|function|class|interface|type|struct|enum|fn|pub\s+fn|pub\s+struct)\b/;

      if (signatureRegex.test(lineText) || lineText.includes(':=') || lineText.includes(' = (')) {
        return lineText.replace(/[\{\}:]+\s*$/, '').trim();
      }
    }

    return undefined;
  }

  /**
   * Finds all comments in an active TextDocument, aggregating contiguous single-line comments.
   */
  public static extractDocumentComments(document: vscode.TextDocument): ExtractedComment[] {
    const comments: ExtractedComment[] = [];
    const lineCount = document.lineCount;
    const langId = document.languageId;
    const lineCommentPrefix =
      langId === 'python' || langId === 'shellscript' || langId === 'dockerfile' ? '#' : '//';

    let i = 0;
    while (i < lineCount) {
      const line = document.lineAt(i);
      const text = line.text;

      // 1. Check single-line comment (// or #)
      const prefixIdx = text.indexOf(lineCommentPrefix);
      if (prefixIdx !== -1) {
        let startLine = i;
        let endLine = i;

        // Group all contiguous comment lines together
        while (endLine + 1 < lineCount) {
          const nextText = document.lineAt(endLine + 1).text;
          if (nextText.indexOf(lineCommentPrefix) === -1) break;
          endLine++;
        }

        const rawLines: string[] = [];
        for (let k = startLine; k <= endLine; k++) {
          const lTxt = document.lineAt(k).text;
          rawLines.push(lTxt.slice(lTxt.indexOf(lineCommentPrefix)));
        }

        const rawText = rawLines.join('\n');
        const cleanText = this.cleanCommentText(rawText);
        const range = new vscode.Range(
          new vscode.Position(startLine, prefixIdx),
          document.lineAt(endLine).range.end
        );

        if (cleanText.length > 2) {
          const sig = this.findAssociatedSignature(document, endLine);
          comments.push({ range, cleanText, rawText, isBlock: false, associatedCodeSignature: sig });
        }

        i = endLine + 1;
        continue;
      }

      // 2. Check block comments (/* ... */)
      const blockStartIdx = text.indexOf('/*');
      if (blockStartIdx !== -1) {
        let endLine = i;
        let blockEndIdx = text.indexOf('*/', blockStartIdx + 2);

        if (blockEndIdx === -1) {
          // Multi-line block
          while (endLine + 1 < lineCount) {
            endLine++;
            const lText = document.lineAt(endLine).text;
            const foundEnd = lText.indexOf('*/');
            if (foundEnd !== -1) {
              blockEndIdx = foundEnd + 2;
              break;
            }
          }
        } else {
          blockEndIdx += 2;
        }

        if (blockEndIdx !== -1) {
          const range = new vscode.Range(
            new vscode.Position(i, blockStartIdx),
            new vscode.Position(endLine, blockEndIdx)
          );
          const rawText = document.getText(range);
          const cleanText = this.cleanCommentText(rawText);
          const sig = this.findAssociatedSignature(document, endLine);
          if (cleanText.length > 2) {
            comments.push({ range, cleanText, rawText, isBlock: true, associatedCodeSignature: sig });
          }
          i = endLine + 1;
          continue;
        }
      }

      i++;
    }

    return comments;
  }
}
