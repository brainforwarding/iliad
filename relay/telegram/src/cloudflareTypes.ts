export interface ExecutionContextLike {
  waitUntil?(promise: Promise<unknown>): void;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

export interface DurableObjectIdLike {
  toString(): string;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  waitUntil?(promise: Promise<unknown>): void;
}

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

export interface WebSocketPairConstructor {
  new (): { 0: WebSocket; 1: WebSocket };
}

export interface ResponseInitWithWebSocket extends ResponseInit {
  webSocket?: WebSocket;
}

export interface TelegramRelayEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_RELAY?: DurableObjectNamespaceLike;
}

declare global {
  const WebSocketPair: WebSocketPairConstructor | undefined;
}
