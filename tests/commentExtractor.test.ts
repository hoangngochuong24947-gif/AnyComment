import { describe, it, expect } from 'vitest';
import { CommentExtractor } from '../src/parser/commentExtractor.js';
import { Position } from './mocks/vscode.js';

describe('CommentExtractor Tests', () => {
  it('cleanCommentText should preserve formatting and line breaks', () => {
    const raw = `// First paragraph of explanation.
//
// Second paragraph with details.`;
    const clean = CommentExtractor.cleanCommentText(raw);
    expect(clean).toContain('First paragraph of explanation.');
    expect(clean).toContain('Second paragraph with details.');
    expect(clean.includes('\n')).toBe(true);
  });

  it('cleanCommentText should remove block comment markers', () => {
    const raw = `/**
 * Calculate the sum of two integers.
 * @param a First integer
 * @param b Second integer
 */`;
    const clean = CommentExtractor.cleanCommentText(raw);
    expect(clean).toContain('Calculate the sum of two integers.');
    expect(clean).toContain('@param a First integer');
    expect(clean).not.toContain('/**');
    expect(clean).not.toContain('*/');
  });

  it('extractEnclosingComment should group contiguous single-line comments together', () => {
    const lines = [
      'package main',
      '// ListenAndServe listens on addr',
      '// and handles incoming HTTP requests.',
      '// Accepted connections enable keep-alive.',
      'func ListenAndServe() {}',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'go',
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    // Hover on line 2 (middle of the 3-line comment)
    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(2, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('ListenAndServe listens on addr');
    expect(res?.cleanText).toContain('Accepted connections enable keep-alive.');
    expect(res?.range.start.line).toBe(1);
    expect(res?.range.end.line).toBe(3);
    expect(res?.associatedCodeSignature).toBe('func ListenAndServe()');
  });

  it('extractEnclosingComment should capture enclosing block comment from middle line', () => {
    const lines = [
      '/**',
      ' * User represents a developer account.',
      ' * It stores authentication keys.',
      ' */',
      'type User struct {}',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'go',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    // Hover on line 2 (inside the block comment)
    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(2, 8) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('User represents a developer account.');
    expect(res?.cleanText).toContain('It stores authentication keys.');
    expect(res?.range.start.line).toBe(0);
    expect(res?.range.end.line).toBe(3);
  });
});
