# ADR 0001: Partitioned Storage and Multi-Provider Decoupling

## Status
Accepted

## Context
AnyComment needs to provide responsive translation and technical explanation for code comments and external library documentation in VS Code. Calling external LLMs on every hover causes latency and token costs. Furthermore, user-customized explanation styles should not pollute objective baseline translations of standard libraries.

## Decision
1. **Multi-Provider Architecture**:
   - Model Registry pattern implementing `ITranslationProvider`.
   - Providers: `OpenAICompatibleProvider`, `VSCodeLMProvider`, `GoogleTranslateProvider`.
2. **Dual-Partition Global Storage**:
   - Stored in `context.globalStorageUri`.
   - `standard_store/`: Pre-bundled seed translations + standard MT baseline.
   - `custom_style_store/`: Segmented by style ID. Modifying styles touches only this partition.
3. **Pure TypeScript Engine**:
   - Avoid native C++ addons (`better-sqlite3`). Use JSON/KV partitioning or WASM to ensure 100% portable zero-crash operation inside VS Code's extension host.
