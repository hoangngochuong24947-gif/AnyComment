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

  it('extractEnclosingComment should extract Python triple-quote docstring containing kappa_L', () => {
    const lines = [
      '#!/usr/bin/env python3',
      '"""',
      'generate_fig6_crystals_phonons.py',
      '==================================',
      'Generates publication-ready crystal structures.',
      '',
      'Features:',
      '- 3D/2D unit cell rendering',
      '- Full-Brillouin-zone MACE',
      '  (a) Sn7Se11 (P1, 18 atoms)',
      '  (b) Bi3Sb2Te3 (Pm, 8 atoms)',
      '  (c) TePb (Cmcm, 4 atoms, kappa_L = 0.4367 W/mK, zT ~ 2.41)',
      '  (d) Comprehensive transport properties comparison',
      '',
      'Author: Scientific Figure Pipeline',
      '"""',
      'def main(): pass',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'python',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    // Hover on line 11 (the line with kappa_L)
    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(11, 30) as any);
    expect(res).toBeDefined();
    // It must NOT extract just "kappa_L", it must extract the features context!
    expect(res?.cleanText).toContain('kappa_L = 0.4367 W/mK');
    expect(res?.cleanText).toContain('Features:');
    expect(res?.cleanText).toContain('TePb (Cmcm, 4 atoms');
  });

  it('extractTripleQuoteBlock should support single-quote Python docstring', () => {
    const lines = [
      "'''",
      'Simple docstring with single quotes.',
      'Second line of documentation.',
      "'''",
      'def foo(): pass',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'python',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Simple docstring with single quotes.');
  });

  it('extractEnclosingString should extract quoted strings', () => {
    const lines = [
      'raise ValueError("Invalid configuration for kappa_L, must be positive")',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'python',
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    const res = CommentExtractor.extractEnclosingString(mockDoc, new Position(0, 35) as any);
    expect(res).toBe('Invalid configuration for kappa_L, must be positive');
  });

  it('extractEnclosingComment should support Rust doc comments (///) and pub fn signature', () => {
    const lines = [
      '/// Computes the phonon dispersion curve',
      '/// along high-symmetry Brillouin paths.',
      'pub fn compute_phonons(q: &[f64]) -> Vec<f64> {',
      '    vec![]',
      '}',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'rust',
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(0, 10) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Computes the phonon dispersion curve');
    expect(res?.cleanText).toContain('along high-symmetry Brillouin paths.');
    expect(res?.associatedCodeSignature).toBe('pub fn compute_phonons(q: &[f64]) -> Vec<f64>');
  });

  it('extractEnclosingComment should support Rust inner module doc comments (//!)', () => {
    const lines = [
      '//! # Thermal Transport Simulation',
      '//! Provides Boltzmann transport solvers.',
      'use std::sync::Arc;',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'rust',
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 12) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('# Thermal Transport Simulation');
    expect(res?.cleanText).toContain('Provides Boltzmann transport solvers.');
  });

  it('extractEnclosingComment should support Ruby single-line and =begin/=end block comments', () => {
    // Single line
    const rubyLines = [
      '# Calculates thermoelectric figure of merit (zT)',
      '# based on electronic conductivity.',
      'def calculate_zt(temp, seebeck)',
      'end',
    ];

    const mockRubyDoc: any = {
      lineCount: rubyLines.length,
      languageId: 'ruby',
      lineAt: (i: number) => ({ text: rubyLines[i] }),
    };

    const res1 = CommentExtractor.extractEnclosingComment(mockRubyDoc, new Position(0, 15) as any);
    expect(res1).toBeDefined();
    expect(res1?.cleanText).toContain('Calculates thermoelectric figure of merit (zT)');
    expect(res1?.associatedCodeSignature).toBe('def calculate_zt(temp, seebeck)');

    // =begin/=end block
    const rubyBlockLines = [
      '=begin',
      'Detailed documentation of Boltzmann transport.',
      'Includes relaxation time approximation.',
      '=end',
      'def boltzmann; end',
    ];

    const mockRubyBlockDoc: any = {
      lineCount: rubyBlockLines.length,
      languageId: 'ruby',
      lineAt: (i: number) => ({ text: rubyBlockLines[i] }),
      getText: (range: any) => rubyBlockLines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res2 = CommentExtractor.extractEnclosingComment(mockRubyBlockDoc, new Position(1, 10) as any);
    expect(res2).toBeDefined();
    expect(res2?.cleanText).toContain('Detailed documentation of Boltzmann transport.');
    expect(res2?.cleanText).not.toContain('=begin');
  });

  it('extractEnclosingComment should support SQL comments (-- and /* */) and signatures', () => {
    const lines = [
      '-- Aggregates lattice thermal conductivity statistics',
      '-- across all crystal materials in database.',
      'CREATE PROCEDURE GetThermalStats()',
      'BEGIN',
      'END;',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'sql',
      lineAt: (i: number) => ({ text: lines[i] }),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 10) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Aggregates lattice thermal conductivity statistics');
    expect(res?.associatedCodeSignature).toBe('CREATE PROCEDURE GetThermalStats()');
  });

  it('extractEnclosingComment should support Lua block comments (--[[ ... ]])', () => {
    const lines = [
      '--[[',
      'Renders high-symmetry paths in Brillouin zone.',
      'Supports Gamma, X, M points.',
      ']]',
      'function render_paths()',
      'end',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'lua',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 10) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Renders high-symmetry paths in Brillouin zone.');
    expect(res?.cleanText).toContain('Supports Gamma, X, M points.');
    expect(res?.associatedCodeSignature).toBe('function render_paths()');
  });

  it('extractEnclosingComment should support PowerShell block comments (<# ... #>)', () => {
    const lines = [
      '<#',
      '.SYNOPSIS',
      'Starts phonon thermal calculation pipeline.',
      '#>',
      'function Start-PhononPipeline {',
      '}',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'powershell',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(2, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Starts phonon thermal calculation pipeline.');
    expect(res?.cleanText).not.toContain('<#');
  });

  it('extractEnclosingComment should support Haskell block comments ({- ... -})', () => {
    const lines = [
      '{-',
      'Calculates harmonic force constants from DFT.',
      '-}',
      'computeHarmonic :: Matrix -> Vector',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'haskell',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Calculates harmonic force constants from DFT.');
  });

  it('extractEnclosingComment should support OCaml block comments (* ... *)', () => {
    const lines = [
      '(*',
      '  Evaluates Seebeck coefficient using Boltzmann equations.',
      '*)',
      'let eval_seebeck = fun temp -> temp *. 0.5',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'ocaml',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Evaluates Seebeck coefficient using Boltzmann equations.');
  });

  it('extractEnclosingComment should support MATLAB % and %{ ... %} comments', () => {
    const lines = [
      '%{',
      'Calculates acoustic mode group velocity.',
      '%}',
      'function [v_g] = compute_group_velocity(freq, q)',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'matlab',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(1, 5) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Calculates acoustic mode group velocity.');
    expect(res?.associatedCodeSignature).toBe('function [v_g] = compute_group_velocity(freq, q)');
  });

  it('extractEnclosingComment should support Markdown prose paragraphs without truncation', () => {
    const lines = [
      '# Introduction to Thermoelectric Materials',
      '',
      'Thermoelectric generators directly convert thermal energy into electricity.',
      'The conversion efficiency is governed by the dimensionless figure of merit zT.',
      'Recent developments in nanostructured half-Heusler alloys exhibit high performance.',
      '',
      '## Experimental Methods',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'markdown',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => lines.slice(range.start.line, range.end.line + 1).join('\n'),
    };

    // Hover on line 3 (middle of the prose paragraph)
    const res = CommentExtractor.extractEnclosingComment(mockDoc, new Position(3, 10) as any);
    expect(res).toBeDefined();
    expect(res?.cleanText).toContain('Thermoelectric generators directly convert thermal energy into electricity.');
    expect(res?.cleanText).toContain('Recent developments in nanostructured half-Heusler alloys exhibit high performance.');
  });

  it('extractEnclosingString should support multiline backtick template strings', () => {
    const lines = [
      'const prompt = `',
      'Please analyze the crystal lattice and determine',
      'the phonon dispersion branches and thermal conductivity.',
      '`;',
    ];

    const mockDoc: any = {
      lineCount: lines.length,
      languageId: 'typescript',
      lineAt: (i: number) => ({ text: lines[i] }),
      getText: (range: any) => {
        const full = lines.join('\n');
        // Simple slice simulation
        return lines.slice(1, 3).join('\n');
      },
    };

    const res = CommentExtractor.extractEnclosingString(mockDoc, new Position(1, 10) as any);
    expect(res).toBeDefined();
    expect(res).toContain('Please analyze the crystal lattice');
  });
});


