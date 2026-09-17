# AnyComment Context & Architecture

AnyComment is a lightweight, personalized VS Code extension for translating code comments and API documentation. It integrates multi-provider AI translation with local disk caching and dual-partition storage.

## Core Concepts & Domain Model

1. **Provider (`ITranslationProvider`)**:
   - Pluggable translation engines.
   - Built-in providers:
     - `openai`: OpenAI-compatible endpoint (DeepSeek, Ollama, Qwen, etc.).
     - `vscode-lm`: GitHub Copilot language models via VS Code native `vscode.lm` API.
     - `google`: Google Translate public endpoint for zero-setup, zero-cost traditional machine translation.
   - `ProviderRegistry`: Coordinates active provider resolution and fallback.

2. **Prompt Style (`PromptStyle`)**:
   - Presets:
     - `tech-plain`: Developer-friendly translation retaining original technical keywords (Goroutine, Mutex, Promise).
     - `literal`: Direct, formal translation keeping exact formatting.
     - `deep-dive`: In-depth analysis explaining parameters, return values, and gotchas/caveats.
     - `custom`: User-editable system and user prompts.

3. **Partitioned Storage (`StorageManager`)**:
   - Located at `context.globalStorageUri` (cross-workspace global persistent cache).
   - **Partition 1: Standard Store (`standard_store/`)**:
     - Pre-bundled seeds of high-frequency Go/TS/Python standard library function documentation.
     - Objective traditional translations.
   - **Partition 2: Custom Style Store (`custom_style_store/`)**:
     - Subdirectory per prompt style ID.
     - Custom AI-explained documentation is physically isolated from canonical standard documentation.
     - Can be cleared, tuned, or re-generated independently.

4. **Interaction Surfaces**:
   - **LSP Hover Interception**: Appends translations or `[Translate]` command links to function tooltips.
   - **Immersive Decorator (`Cmd+Shift+B`)**: Renders inline ghost text translations at the end of comment lines.
   - **Status Bar Item**: Displays active provider & style; click to switch.
   - **Sidebar Webview Panel**: Full control center for prompts, API configuration, and storage maintenance.
