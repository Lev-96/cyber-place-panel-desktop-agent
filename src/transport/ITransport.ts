import { AgentEvent, ServerCommand } from "@/protocol/Messages";

export type TransportStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ITransport {
  connect(): Promise<void>;
  close(): void;
  send<T>(event: AgentEvent<T>): void;
  onCommand(handler: (cmd: ServerCommand) => void): () => void;
  onStatus(handler: (s: TransportStatus) => void): () => void;
  status(): TransportStatus;
}

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
