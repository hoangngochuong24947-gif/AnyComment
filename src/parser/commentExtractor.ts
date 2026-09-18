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
      // Remove HTML comment markers <!--, -->
      cleaned = cleaned.replace(/^<!--\s?/, '');
      cleaned = cleaned.replace(/-->$/, '');
      // Remove leading * in JSDoc/GoDoc blocks
      cleaned = cleaned.replace(/^\*\s?/, '');
      // Remove python/shell #
      cleaned = cleaned.replace(/^#\s?/, '');
      // Remove sql/lua --
      cleaned = cleaned.replace(/^--\s?/, '');
      // Remove ini/lisp ;
      cleaned = cleaned.replace(/^;\s?/, '');
      // Remove python triple quotes """ or '''
      cleaned = cleaned.replace(/^"""\s?/, '').replace(/"""$/, '');
      cleaned = cleaned.replace(/^'''\s?/, '').replace(/'''$/, '');
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
   * Extracts the full contiguous enclosing comment block or docstring at cursor position.
   * Handles multi-line //, #, -- blocks, multiline /* ... *\/ blocks, and Python """ / ''' docstrings.
   */
  public static extractEnclosingComment(
    document: vscode.TextDocument,
    position: vscode.Position
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    const currentLine = document.lineAt(lineIndex).text;
    const langId = document.languageId;

    let lineCommentPrefix = '//';
    if (langId === 'python' || langId === 'shellscript' || langId === 'dockerfile' || langId === 'yaml') {
      lineCommentPrefix = '#';
    } else if (langId === 'sql' || langId === 'lua') {
      lineCommentPrefix = '--';
    } else if (langId === 'ini' || langId === 'clojure' || langId === 'lisp') {
      lineCommentPrefix = ';';
    }

    // 1. Check if cursor is on a line comment (//, #, --, ;)
    const prefixIdx = currentLine.indexOf(lineCommentPrefix);
    if (prefixIdx !== -1 && position.character >= prefixIdx) {
      let startLine = lineIndex;
      let endLine = lineIndex;

      // Scan upwards for contiguous single-line comments
      while (startLine > 0) {
        const prevText = document.lineAt(startLine - 1).text;
        const prevIdx = prevText.indexOf(lineCommentPrefix);
        if (prevIdx === -1) break;
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

    // 2. Check Python / Julia / Elixir docstrings (""" or ''')
    const pythonQuotes: Array<'"""' | "'''"> = ['"""', "'''"];
    for (const quote of pythonQuotes) {
      const docBlock = this.extractTripleQuoteBlock(document, position, quote);
      if (docBlock) {
        return docBlock;
      }
    }

    // 3. Check C-style block comments (/* ... */)
    const cBlock = this.extractDelimiterBlock(document, position, '/*', '*/');
    if (cBlock) {
      return cBlock;
    }

    // 4. Check HTML / XML / Markdown block comments (<!-- ... -->)
    const htmlBlock = this.extractDelimiterBlock(document, position, '<!--', '-->');
    if (htmlBlock) {
      return htmlBlock;
    }

    // 5. Check Lua block comments (--[[ ... ]])
    const luaBlock = this.extractDelimiterBlock(document, position, '--[[', ']]');
    if (luaBlock) {
      return luaBlock;
    }

    return undefined;
  }

  /**
   * Extracts enclosing triple-quoted docstrings (""" or ''').
   */
  public static extractTripleQuoteBlock(
    document: vscode.TextDocument,
    position: vscode.Position,
    delimiter: '"""' | "'''"
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    const currentLine = document.lineAt(lineIndex).text;

    // 1. Single-line triple quote: """docstring"""
    const firstIdx = currentLine.indexOf(delimiter);
    if (firstIdx !== -1) {
      const secondIdx = currentLine.indexOf(delimiter, firstIdx + 3);
      if (secondIdx !== -1) {
        if (position.character >= firstIdx && position.character <= secondIdx + 3) {
          const rawText = currentLine.slice(firstIdx, secondIdx + 3);
          const cleanText = this.cleanCommentText(rawText);
          const range = new vscode.Range(
            new vscode.Position(lineIndex, firstIdx),
            new vscode.Position(lineIndex, secondIdx + 3)
          );
          const associatedCodeSignature = this.findAssociatedSignature(document, lineIndex);
          return { range, cleanText, rawText, isBlock: true, associatedCodeSignature };
        }
      }
    }

    // 2. Multiline triple quote: count occurrences up to cursor
    let occurrencesBefore = 0;
    let lastOpenLine = -1;
    let lastOpenCol = -1;

    const scanStartLine = Math.max(0, lineIndex - 600);
    for (let i = scanStartLine; i <= lineIndex; i++) {
      const text = document.lineAt(i).text;
      let searchPos = 0;
      while (searchPos < text.length) {
        const found = text.indexOf(delimiter, searchPos);
        if (found === -1) break;

        const isEscaped = found > 0 && text[found - 1] === '\\';
        if (!isEscaped) {
          if (i === lineIndex && found > position.character) {
            break;
          }
          occurrencesBefore++;
          if (occurrencesBefore % 2 === 1) {
            lastOpenLine = i;
            lastOpenCol = found;
          }
        }
        searchPos = found + 3;
      }
    }

    // Odd occurrences means cursor is inside the open block!
    if (occurrencesBefore % 2 === 1 && lastOpenLine !== -1) {
      let closeLine = -1;
      let closeCol = -1;

      for (let i = lineIndex; i < Math.min(document.lineCount, lineIndex + 600); i++) {
        const text = document.lineAt(i).text;
        const startSearch = i === lineIndex ? Math.max(0, position.character) : 0;
        const found = text.indexOf(delimiter, startSearch);
        if (found !== -1) {
          closeLine = i;
          closeCol = found + 3;
          break;
        }
      }

      if (closeLine !== -1) {
        const fullRange = new vscode.Range(
          new vscode.Position(lastOpenLine, lastOpenCol),
          new vscode.Position(closeLine, closeCol)
        );
        const rawFullText = document.getText(fullRange);

        // If docstring spans more than 15 lines with multiple paragraphs,
        // extract the specific paragraph around the cursor for sharp, high-speed translation!
        let targetRange = fullRange;
        let targetRawText = rawFullText;

        const totalBlockLines = closeLine - lastOpenLine;
        if (totalBlockLines > 12) {
          let paraStart = lineIndex;
          while (paraStart > lastOpenLine + 1) {
            const prev = document.lineAt(paraStart - 1).text.trim();
            if (prev === '' || prev === delimiter) break;
            paraStart--;
          }
          let paraEnd = lineIndex;
          while (paraEnd < closeLine - 1) {
            const next = document.lineAt(paraEnd + 1).text.trim();
            if (next === '' || next === delimiter) break;
            paraEnd++;
          }

          if (paraEnd - paraStart < totalBlockLines - 1) {
            targetRange = new vscode.Range(
              new vscode.Position(paraStart, 0),
              new vscode.Position(paraEnd, document.lineAt(paraEnd).text.length)
            );
            targetRawText = document.getText(targetRange);
          }
        }

        const cleanText = this.cleanCommentText(targetRawText);
        const associatedCodeSignature = this.findAssociatedSignature(document, closeLine);

        return {
          range: targetRange,
          cleanText: cleanText.length > 2 ? cleanText : this.cleanCommentText(rawFullText),
          rawText: targetRawText,
          isBlock: true,
          associatedCodeSignature,
        };
      }
    }

    return undefined;
  }

  /**
   * General delimiter block extractor for /* ... *\/, <!-- ... -->, --[[ ... ]].
   */
  public static extractDelimiterBlock(
    document: vscode.TextDocument,
    position: vscode.Position,
    startDelim: string,
    endDelim: string
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    let blockStartLine = -1;
    let blockStartCol = -1;

    for (let i = lineIndex; i >= Math.max(0, lineIndex - 300); i--) {
      const text = document.lineAt(i).text;
      const startIdx = text.lastIndexOf(startDelim);
      const endIdx = text.lastIndexOf(endDelim);

      if (startIdx !== -1 && (endIdx === -1 || startIdx > endIdx)) {
        blockStartLine = i;
        blockStartCol = startIdx;
        break;
      }
      if (endIdx !== -1 && i < lineIndex) {
        break;
      }
    }

    if (blockStartLine !== -1) {
      let blockEndLine = -1;
      let blockEndCol = -1;

      for (let i = lineIndex; i < Math.min(document.lineCount, lineIndex + 300); i++) {
        const text = document.lineAt(i).text;
        const endIdx = text.indexOf(endDelim);
        if (endIdx !== -1) {
          blockEndLine = i;
          blockEndCol = endIdx + endDelim.length;
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
   * Extracts enclosing string literal content on the current line ("...", '...', `...`).
   */
  public static extractEnclosingString(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | undefined {
    const line = document.lineAt(position.line).text;
    const col = position.character;

    const quotes = ['"', "'", '`'];
    for (const q of quotes) {
      let start = line.lastIndexOf(q, col - 1);
      while (start > 0 && line[start - 1] === '\\') {
        start = line.lastIndexOf(q, start - 1);
      }
      if (start !== -1) {
        let end = line.indexOf(q, col);
        while (end !== -1 && line[end - 1] === '\\') {
          end = line.indexOf(q, end + 1);
        }
        if (end !== -1) {
          const content = line.slice(start + 1, end).trim();
          if (content.length > 2) {
            return content;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Extracts inline trailing comment on the given line (e.g. `const x = 1; // comment`).
   */
  public static extractInlineComment(document: vscode.TextDocument, lineIndex: number): string | undefined {
    const line = document.lineAt(lineIndex).text;
    const prefixes = ['//', '#', '--', ';'];

    for (const p of prefixes) {
      const idx = line.indexOf(p);
      if (idx !== -1) {
        const comment = line.slice(idx + p.length).trim();
        if (comment.length > 2) {
          return comment;
        }
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
