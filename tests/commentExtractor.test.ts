import { describe, it, expect } from 'vitest';
import { CommentExtractor } from '../src/parser/commentExtractor.js';

describe('CommentExtractor Tests', () => {
  it('cleanCommentText should remove C++ style comments', () => {
    const raw = '// This is a single line comment';
    const clean = CommentExtractor.cleanCommentText(raw);
    expect(clean).toBe('This is a single line comment');
  });

  it('cleanCommentText should remove block comments and docstars', () => {
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

  it('cleanCommentText should remove Python hash comments', () => {
    const raw = '# Process data using worker queue';
    const clean = CommentExtractor.cleanCommentText(raw);
    expect(clean).toBe('Process data using worker queue');
  });

  it('findAssociatedSignature should identify functions and struct types', () => {
    // Mock document
    const lines = [
      '// ListenAndServe listens on addr',
      'func ListenAndServe(addr string, handler Handler) error {',
      '    return nil',
      '}',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    const sig = CommentExtractor.findAssociatedSignature(mockDoc, 0);
    expect(sig).toBe('func ListenAndServe(addr string, handler Handler) error');
  });
});
