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
   * Cleans comment prefixes (//, /*, *, #) and whitespace
   */
  public static cleanCommentText(rawText: string): string {
    return rawText
      .split('\n')
      .map((line) => {
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
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Ultra-lightweight lookahead: inspects 1~4 lines below the comment to grab the code signature.
   * Recognizes functions, methods, classes, types, structs, and interfaces across Go, TS, Python, Rust.
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
        // Strip trailing open braces or colons for clean presentation
        return lineText.replace(/[\{\}:]+\s*$/, '').trim();
      }
    }

    return undefined;
  }

  /**
   * Finds all comments in an active TextDocument for decoration rendering
   */
  public static extractDocumentComments(document: vscode.TextDocument): ExtractedComment[] {
    const comments: ExtractedComment[] = [];
    const lineCount = document.lineCount;
    const langId = document.languageId;

    let inBlockComment = false;
    let blockStartLine = 0;
    let blockStartChar = 0;
    let blockLines: string[] = [];

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      if (inBlockComment) {
        blockLines.push(text);
        const endIdx = text.indexOf('*/');
        if (endIdx !== -1) {
          inBlockComment = false;
          const endPos = new vscode.Position(i, endIdx + 2);
          const startPos = new vscode.Position(blockStartLine, blockStartChar);
          const range = new vscode.Range(startPos, endPos);
          const rawText = blockLines.join('\n');
          const cleanText = CommentExtractor.cleanCommentText(rawText);
          const associatedCodeSignature = CommentExtractor.findAssociatedSignature(document, i);

          if (cleanText.length > 2) {
            comments.push({ range, cleanText, rawText, isBlock: true, associatedCodeSignature });
          }
          blockLines = [];
        }
        continue;
      }

      // Check Python / Shell comments (#)
      if (langId === 'python' || langId === 'shellscript' || langId === 'dockerfile') {
        const hashIdx = text.indexOf('#');
        if (hashIdx !== -1) {
          const raw = text.slice(hashIdx);
          const clean = CommentExtractor.cleanCommentText(raw);
          const associatedCodeSignature = CommentExtractor.findAssociatedSignature(document, i);
          if (clean.length > 2) {
            comments.push({
              range: new vscode.Range(new vscode.Position(i, hashIdx), line.range.end),
              cleanText: clean,
              rawText: raw,
              isBlock: false,
              associatedCodeSignature,
            });
          }
        }
        continue;
      }

      // Check C-style block comments (/* ... */)
      const blockStartIdx = text.indexOf('/*');
      if (blockStartIdx !== -1) {
        const blockEndIdx = text.indexOf('*/', blockStartIdx + 2);
        if (blockEndIdx !== -1) {
          const range = new vscode.Range(
            new vscode.Position(i, blockStartIdx),
            new vscode.Position(i, blockEndIdx + 2)
          );
          const raw = text.substring(blockStartIdx, blockEndIdx + 2);
          const clean = CommentExtractor.cleanCommentText(raw);
          const associatedCodeSignature = CommentExtractor.findAssociatedSignature(document, i);
          if (clean.length > 2) {
            comments.push({ range, cleanText: clean, rawText: raw, isBlock: true, associatedCodeSignature });
          }
          continue;
        } else {
          inBlockComment = true;
          blockStartLine = i;
          blockStartChar = blockStartIdx;
          blockLines = [text.slice(blockStartIdx)];
          continue;
        }
      }

      // Check single-line comments (//)
      const slashIdx = text.indexOf('//');
      if (slashIdx !== -1) {
        const raw = text.slice(slashIdx);
        const clean = CommentExtractor.cleanCommentText(raw);
        const associatedCodeSignature = CommentExtractor.findAssociatedSignature(document, i);
        if (clean.length > 2) {
          comments.push({
            range: new vscode.Range(new vscode.Position(i, slashIdx), line.range.end),
            cleanText: clean,
            rawText: raw,
            isBlock: false,
            associatedCodeSignature,
          });
        }
      }
    }

    return comments;
  }
}
