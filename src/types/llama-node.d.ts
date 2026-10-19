declare module '@fugood/llama.node' {
  type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

  type CompletionResult = {
    text: string;
    content?: string;
    truncated: boolean;
    context_full: boolean;
  };

  type LlamaContext = {
    completion(options: {
      messages: ChatMessage[];
      n_predict?: number;
      temperature?: number;
    }): Promise<CompletionResult>;
    stopCompletion(): void;
    release(): Promise<void>;
  };

  export function loadModel(options: {
    model: string;
    n_ctx?: number;
    n_gpu_layers?: number;
  }): Promise<LlamaContext>;
}
