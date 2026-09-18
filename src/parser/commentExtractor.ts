import * as vscode from 'vscode';

export type ExtractedComment = {
  range: vscode.Range;
  cleanText: string;
  rawText: string;
  isBlock: boolean;
  associatedCodeSignature?: string;
};

type BlockDelimiterPair = {
  start: string;
  end: string;
};

/**
 * Universal comment, docstring, and prose paragraph extractor.
 * Zero external dependencies, pure regex and fast line scanning (<1ms).
 * Covers 30+ programming languages and documentation formats.
 */
export class CommentExtractor {
  /**
   * Mapping of language IDs to known line comment prefixes and block delimiters.
   */
  private static readonly LANGUAGE_MAP: Record<
    string,
    { linePrefixes: string[]; blockDelimiters: BlockDelimiterPair[] }
  > = {
    // Python & Julia & Elixir
    python: {
      linePrefixes: ['#'],
      blockDelimiters: [
        { start: '"""', end: '"""' },
        { start: "'''", end: "'''" },
      ],
    },
    julia: {
      linePrefixes: ['#'],
      blockDelimiters: [
        { start: '#=', end: '=#' },
        { start: '"""', end: '"""' },
      ],
    },
    elixir: {
      linePrefixes: ['#'],
      blockDelimiters: [
        { start: '"""', end: '"""' },
        { start: "'''", end: "'''" },
      ],
    },

    // Rust (supports doc comments ///, //! and /* */)
    rust: {
      linePrefixes: ['///', '//! ', '//'],
      blockDelimiters: [{ start: '/*', end: '*/' }],
    },

    // Shell, Docker, YAML, TOML, Scripting
    shellscript: { linePrefixes: ['#'], blockDelimiters: [] },
    bash: { linePrefixes: ['#'], blockDelimiters: [] },
    sh: { linePrefixes: ['#'], blockDelimiters: [] },
    zsh: { linePrefixes: ['#'], blockDelimiters: [] },
    dockerfile: { linePrefixes: ['#'], blockDelimiters: [] },
    yaml: { linePrefixes: ['#'], blockDelimiters: [] },
    toml: { linePrefixes: ['#'], blockDelimiters: [] },
    makefile: { linePrefixes: ['#'], blockDelimiters: [] },
    cmake: {
      linePrefixes: ['#'],
      blockDelimiters: [{ start: '#[[', end: ']]' }],
    },
    r: { linePrefixes: ['#'], blockDelimiters: [] },
    perl: { linePrefixes: ['#'], blockDelimiters: [] },
    ruby: {
      linePrefixes: ['#'],
      blockDelimiters: [{ start: '=begin', end: '=end' }],
    },
    graphql: { linePrefixes: ['#'], blockDelimiters: [] },
    terraform: { linePrefixes: ['#', '//'], blockDelimiters: [{ start: '/*', end: '*/' }] },
    hcl: { linePrefixes: ['#', '//'], blockDelimiters: [{ start: '/*', end: '*/' }] },

    // PowerShell
    powershell: {
      linePrefixes: ['#'],
      blockDelimiters: [{ start: '<#', end: '#>' }],
    },

    // SQL & Lua & Haskell & Functional
    sql: {
      linePrefixes: ['--'],
      blockDelimiters: [{ start: '/*', end: '*/' }],
    },
    lua: {
      linePrefixes: ['--'],
      blockDelimiters: [
        { start: '--[[', end: ']]' },
        { start: '--[=[', end: ']=]' },
      ],
    },
    haskell: {
      linePrefixes: ['--'],
      blockDelimiters: [{ start: '{-', end: '-}' }],
    },
    elm: {
      linePrefixes: ['--'],
      blockDelimiters: [{ start: '{-', end: '-}' }],
    },
    purescript: {
      linePrefixes: ['--'],
      blockDelimiters: [{ start: '{-', end: '-}' }],
    },
    ada: { linePrefixes: ['--'], blockDelimiters: [] },
    vhdl: { linePrefixes: ['--'], blockDelimiters: [] },

    // Academic & Scientific
    latex: { linePrefixes: ['%'], blockDelimiters: [] },
    tex: { linePrefixes: ['%'], blockDelimiters: [] },
    bibtex: { linePrefixes: ['%'], blockDelimiters: [] },
    matlab: {
      linePrefixes: ['%%', '%'],
      blockDelimiters: [{ start: '%{', end: '%}' }],
    },
    octave: {
      linePrefixes: ['#', '%'],
      blockDelimiters: [{ start: '%{', end: '%}' }],
    },
    erlang: { linePrefixes: ['%'], blockDelimiters: [] },

    // Windows Batch
    bat: { linePrefixes: ['REM ', '::'], blockDelimiters: [] },
    cmd: { linePrefixes: ['REM ', '::'], blockDelimiters: [] },

    // INI, Assembly, Lisp
    ini: { linePrefixes: [';', '#'], blockDelimiters: [] },
    clojure: { linePrefixes: [';'], blockDelimiters: [] },
    lisp: { linePrefixes: [';'], blockDelimiters: [] },
    scheme: { linePrefixes: [';'], blockDelimiters: [] },
    racket: { linePrefixes: [';'], blockDelimiters: [] },
    assembly: { linePrefixes: [';', '#', '//'], blockDelimiters: [] },
    autohotkey: {
      linePrefixes: [';'],
      blockDelimiters: [{ start: '/*', end: '*/' }],
    },

    // OCaml, ML, Pascal, Delphi
    ocaml: {
      linePrefixes: [],
      blockDelimiters: [{ start: '(*', end: '*)' }],
    },
    pascal: {
      linePrefixes: ['//'],
      blockDelimiters: [
        { start: '{', end: '}' },
        { start: '(*', end: '*)' },
      ],
    },

    // Web & Markup
    html: { linePrefixes: [], blockDelimiters: [{ start: '<!--', end: '-->' }] },
    xml: { linePrefixes: [], blockDelimiters: [{ start: '<!--', end: '-->' }] },
    svg: { linePrefixes: [], blockDelimiters: [{ start: '<!--', end: '-->' }] },
    vue: {
      linePrefixes: ['//'],
      blockDelimiters: [
        { start: '<!--', end: '-->' },
        { start: '/*', end: '*/' },
      ],
    },
    svelte: {
      linePrefixes: ['//'],
      blockDelimiters: [
        { start: '<!--', end: '-->' },
        { start: '/*', end: '*/' },
      ],
    },
    javascriptreact: {
      linePrefixes: ['//'],
      blockDelimiters: [
        { start: '{/*', end: '*/}' },
        { start: '/*', end: '*/' },
      ],
    },
    typescriptreact: {
      linePrefixes: ['//'],
      blockDelimiters: [
        { start: '{/*', end: '*/}' },
        { start: '/*', end: '*/' },
      ],
    },
  };

  /**
   * Universal list of line comment prefixes, sorted from longest to shortest.
   */
  private static readonly UNIVERSAL_LINE_PREFIXES: string[] = [
    '///',
    '//! ',
    '//! ',
    'REM ',
    '//',
    '--',
    '::',
    '#',
    ';',
    '%',
    '!',
  ];

  /**
   * Universal list of block delimiters.
   */
  private static readonly UNIVERSAL_BLOCK_DELIMITERS: BlockDelimiterPair[] = [
    { start: '/*', end: '*/' },
    { start: '{/*', end: '*/}' },
    { start: '<!--', end: '-->' },
    { start: '"""', end: '"""' },
    { start: "'''", end: "'''" },
    { start: '<#', end: '#>' },
    { start: '--[[', end: ']]' },
    { start: '{-', end: '-}' },
    { start: '(*', end: '*)' },
    { start: '#=', end: '=#' },
    { start: '#[[', end: ']]' },
    { start: '%{', end: '%}' },
    { start: '=begin', end: '=end' },
  ];

  /**
   * Identifies if a document language is prose/documentation (e.g. Markdown, PlainText, RST).
   */
  public static isProseDocument(document: vscode.TextDocument): boolean {
    const langId = document.languageId.toLowerCase();
    return (
      langId === 'markdown' ||
      langId === 'plaintext' ||
      langId === 'restructuredtext' ||
      langId === 'asciidoc' ||
      langId === 'git-commit' ||
      langId === 'scminput'
    );
  }

  /**
   * Cleans comment prefixes while preserving paragraphs and line formatting.
   */
  public static cleanCommentText(rawText: string): string {
    const lines = rawText.split('\n').map((line) => {
      let cleaned = line.trim();

      // 1. Line comment markers
      cleaned = cleaned.replace(/^\/\/\/?\s?/, ''); // // or ///
      cleaned = cleaned.replace(/^\/\/!\s?/, ''); // Rust //!
      cleaned = cleaned.replace(/^#\s?/, ''); // # or ##
      cleaned = cleaned.replace(/^--\s?/, ''); // --
      cleaned = cleaned.replace(/^;\s?/, ''); // ;
      cleaned = cleaned.replace(/^%+\s?/, ''); // % or %%
      cleaned = cleaned.replace(/^(REM|rem)\s+/, ''); // REM
      cleaned = cleaned.replace(/^::\s?/, ''); // ::
      cleaned = cleaned.replace(/^!\s?/, ''); // !

      // 2. Block comment start markers
      cleaned = cleaned.replace(/^\{\/\*\s?/, ''); // JSX {/*
      cleaned = cleaned.replace(/^\/\*\*?\s?/, ''); // /* or /**
      cleaned = cleaned.replace(/^<!--\s?/, ''); // <!--
      cleaned = cleaned.replace(/^<#\s?/, ''); // PowerShell <#
      cleaned = cleaned.replace(/^--\[(=*)\[\s?/, ''); // Lua --[[
      cleaned = cleaned.replace(/^\{\-\s?/, ''); // Haskell {-
      cleaned = cleaned.replace(/^\(\*\s?/, ''); // OCaml (*
      cleaned = cleaned.replace(/^#=\s?/, ''); // Julia #=
      cleaned = cleaned.replace(/^#\[\[\s?/, ''); // CMake #[[
      cleaned = cleaned.replace(/^%\{\s?/, ''); // MATLAB %{
      cleaned = cleaned.replace(/^=begin\s?/, ''); // Ruby =begin

      // 3. Block comment end markers
      cleaned = cleaned.replace(/\*\/\}\s*$/, ''); // JSX */}
      cleaned = cleaned.replace(/\*\/$/, ''); // */
      cleaned = cleaned.replace(/-->$/, ''); // -->
      cleaned = cleaned.replace(/#>\s*$/, ''); // PowerShell #>
      cleaned = cleaned.replace(/\](=*)\]\s*$/, ''); // Lua ]]
      cleaned = cleaned.replace(/\-\}\s*$/, ''); // Haskell -}
      cleaned = cleaned.replace(/\*\)\s*$/, ''); // OCaml *)
      cleaned = cleaned.replace(/=#\s*$/, ''); // Julia =#
      cleaned = cleaned.replace(/\]\]\s*$/, ''); // CMake ]]
      cleaned = cleaned.replace(/%\}\s*$/, ''); // MATLAB %}
      cleaned = cleaned.replace(/^=end\s*$/, ''); // Ruby =end

      // 4. JSDoc/Javadoc/Doxygen leading asterisk
      cleaned = cleaned.replace(/^\*\s?/, '');

      // 5. Python / Julia / Elixir triple quotes
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
   * Sniffs the line comment prefix for the given document and line.
   */
  public static detectLineCommentPrefix(
    document: vscode.TextDocument,
    lineText: string,
    characterCol?: number
  ): string | undefined {
    const langId = document.languageId.toLowerCase();
    const config = this.LANGUAGE_MAP[langId];

    // 1. Check known prefixes configured for this language first
    if (config?.linePrefixes) {
      for (const prefix of config.linePrefixes) {
        const idx = lineText.indexOf(prefix);
        if (idx !== -1 && (characterCol === undefined || characterCol >= idx)) {
          return prefix;
        }
      }
    }

    // 2. Dynamic check across universal prefixes
    const trimmed = lineText.trim();
    for (const prefix of this.UNIVERSAL_LINE_PREFIXES) {
      const idx = lineText.indexOf(prefix);
      if (idx !== -1) {
        // If line starts with this prefix, or cursor is located after prefix
        if (trimmed.startsWith(prefix) || (characterCol !== undefined && characterCol >= idx)) {
          return prefix;
        }
      }
    }

    return undefined;
  }

  /**
   * Extracts the full contiguous enclosing comment block, docstring, or prose paragraph.
   */
  public static extractEnclosingComment(
    document: vscode.TextDocument,
    position: vscode.Position
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    const currentLine = document.lineAt(lineIndex).text;

    // 1. Check if cursor is on a single-line comment (//, ///, #, --, ;, %, REM, etc.)
    const detectedPrefix = this.detectLineCommentPrefix(document, currentLine, position.character);
    if (detectedPrefix) {
      const prefixIdx = currentLine.indexOf(detectedPrefix);
      if (prefixIdx !== -1 && position.character >= prefixIdx) {
        let startLine = lineIndex;
        let endLine = lineIndex;

        // Scan upwards for contiguous single-line comments with the same or compatible prefix
        while (startLine > 0) {
          const prevText = document.lineAt(startLine - 1).text;
          const prevPrefix = this.detectLineCommentPrefix(document, prevText);
          if (!prevPrefix || (prevPrefix !== detectedPrefix && !prevPrefix.startsWith(detectedPrefix.slice(0, 2)))) {
            break;
          }
          startLine--;
        }

        // Scan downwards for contiguous single-line comments
        while (endLine < document.lineCount - 1) {
          const nextText = document.lineAt(endLine + 1).text;
          const nextPrefix = this.detectLineCommentPrefix(document, nextText);
          if (!nextPrefix || (nextPrefix !== detectedPrefix && !nextPrefix.startsWith(detectedPrefix.slice(0, 2)))) {
            break;
          }
          endLine++;
        }

        const rawLines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const txt = document.lineAt(i).text;
          const idx = txt.indexOf(detectedPrefix);
          if (idx !== -1) {
            rawLines.push(txt.slice(idx));
          } else {
            rawLines.push(txt.trim());
          }
        }

        const rawText = rawLines.join('\n');
        const cleanText = this.cleanCommentText(rawText);
        const startCol = document.lineAt(startLine).text.indexOf(detectedPrefix);
        const endCol = document.lineAt(endLine).text.length;

        const range = new vscode.Range(
          new vscode.Position(startLine, Math.max(0, startCol)),
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
    }

    // 2. Check Python / Julia / Elixir docstrings (""" or ''')
    const pythonQuotes: Array<'"""' | "'''"> = ['"""', "'''"];
    for (const quote of pythonQuotes) {
      const docBlock = this.extractTripleQuoteBlock(document, position, quote);
      if (docBlock) {
        return docBlock;
      }
    }

    // 3. Check language-specific block delimiters first
    const langId = document.languageId.toLowerCase();
    const config = this.LANGUAGE_MAP[langId];
    if (config?.blockDelimiters) {
      for (const delim of config.blockDelimiters) {
        const block = this.extractDelimiterBlock(document, position, delim.start, delim.end);
        if (block) {
          return block;
        }
      }
    }

    // 4. Check universal block delimiters
    for (const delim of this.UNIVERSAL_BLOCK_DELIMITERS) {
      const block = this.extractDelimiterBlock(document, position, delim.start, delim.end);
      if (block) {
        return block;
      }
    }

    // 5. If in a prose / documentation file (Markdown, PlainText, RST), extract the paragraph!
    if (this.isProseDocument(document)) {
      const proseBlock = this.extractProseParagraph(document, position);
      if (proseBlock) {
        return proseBlock;
      }
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

    // Odd occurrences means cursor is inside the open block
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
   * General delimiter block extractor for /* ... *\/, <!-- ... -->, <# ... #>, etc.
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
   * Extracts contiguous natural language prose paragraph in Markdown/PlainText/RST files.
   * Paragraphs are bounded by blank lines, markdown headers (^#+\s), or code fences (```).
   */
  public static extractProseParagraph(
    document: vscode.TextDocument,
    position: vscode.Position
  ): ExtractedComment | undefined {
    const lineIndex = position.line;
    const currentLine = document.lineAt(lineIndex).text;

    // Blank line or code fence marker: no prose paragraph
    if (!currentLine.trim() || currentLine.trim().startsWith('```')) {
      return undefined;
    }

    // If current line is a Markdown header (e.g. `## Introduction`)
    if (/^#+\s+/.test(currentLine.trim())) {
      const cleanHeader = currentLine.replace(/^#+\s+/, '').trim();
      return {
        range: new vscode.Range(
          new vscode.Position(lineIndex, 0),
          new vscode.Position(lineIndex, currentLine.length)
        ),
        cleanText: cleanHeader,
        rawText: currentLine,
        isBlock: false,
      };
    }

    let startLine = lineIndex;
    let endLine = lineIndex;

    // Scan upwards until empty line, markdown header, or code fence
    while (startLine > 0) {
      const prev = document.lineAt(startLine - 1).text;
      if (!prev.trim() || /^#+\s+/.test(prev.trim()) || prev.trim().startsWith('```')) {
        break;
      }
      startLine--;
    }

    // Scan downwards until empty line, markdown header, or code fence
    while (endLine < document.lineCount - 1) {
      const next = document.lineAt(endLine + 1).text;
      if (!next.trim() || /^#+\s+/.test(next.trim()) || next.trim().startsWith('```')) {
        break;
      }
      endLine++;
    }

    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );

    const rawText = document.getText(range);
    const cleanText = rawText
      .split('\n')
      .map((l) => l.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanText.length > 2) {
      return {
        range,
        cleanText,
        rawText,
        isBlock: true,
      };
    }

    return undefined;
  }

  /**
   * Extracts enclosing string literal content ("...", '...', `...`), including multiline template literals.
   */
  public static extractEnclosingString(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | undefined {
    const line = document.lineAt(position.line).text;
    const col = position.character;

    // 1. Single-line quotes: ", '
    const quotes = ['"', "'"];
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

    // 2. Multiline backticks (`` ` ``)
    const lineIndex = position.line;
    let tickStartLine = -1;
    let tickStartCol = -1;

    for (let i = lineIndex; i >= Math.max(0, lineIndex - 200); i--) {
      const text = document.lineAt(i).text;
      let idx = i === lineIndex ? text.lastIndexOf('`', col - 1) : text.lastIndexOf('`');
      while (idx > 0 && text[idx - 1] === '\\') {
        idx = text.lastIndexOf('`', idx - 1);
      }
      if (idx !== -1) {
        tickStartLine = i;
        tickStartCol = idx;
        break;
      }
    }

    if (tickStartLine !== -1) {
      for (let i = lineIndex; i < Math.min(document.lineCount, lineIndex + 200); i++) {
        const text = document.lineAt(i).text;
        const searchStart = i === lineIndex ? col : 0;
        let idx = text.indexOf('`', searchStart);
        while (idx !== -1 && text[idx - 1] === '\\') {
          idx = text.indexOf('`', idx + 1);
        }
        if (idx !== -1) {
          const range = new vscode.Range(
            new vscode.Position(tickStartLine, tickStartCol + 1),
            new vscode.Position(i, idx)
          );
          const textInside = document.getText(range).trim();
          if (textInside.length > 2) {
            return textInside;
          }
          break;
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
    const prefix = this.detectLineCommentPrefix(document, line);

    if (prefix) {
      const idx = line.indexOf(prefix);
      if (idx !== -1) {
        const comment = line.slice(idx + prefix.length).trim();
        if (comment.length > 2) {
          return comment;
        }
      }
    }

    return undefined;
  }

  /**
   * Ultra-lightweight lookahead: inspects 1~6 lines below the comment to grab the code signature.
   * Supports Rust, Go, Python, C/C++, C#, Java, TypeScript, Ruby, SQL, Shell.
   */
  public static findAssociatedSignature(document: vscode.TextDocument, endLineIndex: number): string | undefined {
    const maxScanLines = Math.min(document.lineCount, endLineIndex + 7);

    for (let i = endLineIndex + 1; i < maxScanLines; i++) {
      const lineText = document.lineAt(i).text.trim();
      if (!lineText) continue;

      // Stop if hitting another comment line
      if (
        lineText.startsWith('//') ||
        lineText.startsWith('#') ||
        lineText.startsWith('/*') ||
        lineText.startsWith('--') ||
        lineText.startsWith('%') ||
        lineText.startsWith(';')
      ) {
        break;
      }

      // Check multi-language function, type, struct, class signatures
      const signatureRegex =
        /^(export\s+)?(default\s+)?(async\s+)?(func|def|function|class|interface|type|struct|enum|fn|pub\s+fn|pub\s+struct|pub\s+enum|pub\s+trait|trait|impl|public\s+|private\s+|protected\s+|module\s+|CREATE\s+(TABLE|VIEW|PROCEDURE|FUNCTION))\b/i;

      if (
        signatureRegex.test(lineText) ||
        lineText.includes(':=') ||
        lineText.includes(' = (') ||
        lineText.includes('() {')
      ) {
        return lineText.replace(/[\{\}:]+\s*$/, '').trim();
      }
    }

    return undefined;
  }

  /**
   * Finds all comments in an active TextDocument, aggregating contiguous single-line comments.
   * Used for immersive in-editor comment decorations (Cmd+Shift+B).
   */
  public static extractDocumentComments(document: vscode.TextDocument): ExtractedComment[] {
    const comments: ExtractedComment[] = [];
    const lineCount = document.lineCount;
    const langId = document.languageId.toLowerCase();
    const config = this.LANGUAGE_MAP[langId];
    const preferredPrefix = config?.linePrefixes?.[0] || '//';

    let i = 0;
    while (i < lineCount) {
      const line = document.lineAt(i);
      const text = line.text;

      // 1. Check single-line comment using detected or preferred prefix
      const detectedPrefix = this.detectLineCommentPrefix(document, text) || preferredPrefix;
      const prefixIdx = text.indexOf(detectedPrefix);

      if (prefixIdx !== -1 && text.slice(0, prefixIdx).trim() === '') {
        let startLine = i;
        let endLine = i;

        // Group all contiguous comment lines together
        while (endLine + 1 < lineCount) {
          const nextText = document.lineAt(endLine + 1).text;
          const nextPrefix = this.detectLineCommentPrefix(document, nextText);
          if (!nextPrefix || (nextPrefix !== detectedPrefix && !nextPrefix.startsWith(detectedPrefix.slice(0, 2)))) {
            break;
          }
          endLine++;
        }

        const rawLines: string[] = [];
        for (let k = startLine; k <= endLine; k++) {
          const lTxt = document.lineAt(k).text;
          const idx = lTxt.indexOf(detectedPrefix);
          rawLines.push(idx !== -1 ? lTxt.slice(idx) : lTxt);
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

