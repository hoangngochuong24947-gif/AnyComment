import * as vscode from 'vscode';

export interface ExtractedComment {
  range: vscode.Range;
  cleanText: string;
  rawText: string;
  isBlock: boolean;
}

/**
 * Extracts comments from code files across Go, TS/JS, Python, Rust, etc.
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
   * Finds all comments in an active TextDocument for decoration rendering
   */
  public static extractDocumentComments(document: vscode.TextDocument): ExtractedComment[] {
    const comments: ExtractedComment[] = [];
    const text = document.getText();
    const lineCount = document.lineCount;
    const langId = document.languageId;

    let inBlockComment = false;
    let blockStartLine = 0;
    let blockStartChar = 0;
    let blockLines: string[] = [];

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;
      const trimmed = text.trim();

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
          if (cleanText.length > 2) {
            comments.push({ range, cleanText, rawText, isBlock: true });
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
          if (clean.length > 2) {
            comments.push({
              range: new vscode.Range(new vscode.Position(i, hashIdx), line.range.end),
              cleanText: clean,
              rawText: raw,
              isBlock: false,
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
          // Single-line block comment
          const range = new vscode.Range(
            new vscode.Position(i, blockStartIdx),
            new vscode.Position(i, blockEndIdx + 2)
          );
          const raw = text.substring(blockStartIdx, blockEndIdx + 2);
          const clean = CommentExtractor.cleanCommentText(raw);
          if (clean.length > 2) {
            comments.push({ range, cleanText: clean, rawText: raw, isBlock: true });
          }
          continue;
        } else {
          // Multi-line block start
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
        if (clean.length > 2) {
          comments.push({
            range: new vscode.Range(new vscode.Position(i, slashIdx), line.range.end),
            cleanText: clean,
            rawText: raw,
            isBlock: false,
          });
        }
      }
    }

    return comments;
  }
}
