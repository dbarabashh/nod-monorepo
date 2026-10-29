declare module '@fugood/llama.node' {
  type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

  export type CompletionResult = {
    text: string;
    content?: string;
    reasoning_content?: string;
    truncated: boolean;
    context_full: boolean;
  };

  export type LlamaCompletionOptions = {
    messages: ChatMessage[];
    n_predict?: number;
    temperature?: number;
    enable_thinking?: boolean;
    reasoning_format?: 'none' | 'auto' | 'deepseek';
  };

  type LlamaContext = {
    completion(options: LlamaCompletionOptions): Promise<CompletionResult>;
    tokenize(text: string): Promise<{ tokens: Int32Array }>;
    detokenize(tokens: number[]): Promise<string>;
    stopCompletion(): void;
    release(): Promise<void>;
  };

  export function loadModel(options: {
    model: string;
    n_ctx?: number;
    n_gpu_layers?: number;
  }): Promise<LlamaContext>;
}
