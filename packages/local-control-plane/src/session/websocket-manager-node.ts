/**
 * SessionWebSocketManager for Node.js — replaces the Cloudflare Durable Object
 * WebSocket hibernation API with plain ws library management.
 *
 * Key differences from the Cloudflare version:
 * - No hibernation/tags — Node process is persistent, so in-memory Maps suffice.
 * - WebSocket is from the `ws` library, not the global Cloudflare WebSocket.
 * - No ctx.acceptWebSocket / ctx.getWebSockets / ctx.getTags.
 */

import type { WebSocket as WsWebSocket } from "ws";
/** Client info stored in memory per authenticated WebSocket. */
export interface ClientInfo {
  participantId: string;
  userId: string;
  name: string;
  avatar?: string;
  status: "active" | "idle" | "away";
  lastSeen: number;
  clientId: string;
  ws: WsWebSocket;
  lastFetchHistoryAt?: number;
}

export type WsKind = "client" | "sandbox";
export type ParsedTags =
  | { kind: "sandbox"; sandboxId?: string }
  | { kind: "client"; wsId?: string };

export interface SessionWebSocketManager {
  acceptClientSocket(ws: WsWebSocket, wsId: string): void;
  acceptAndSetSandboxSocket(
    ws: WsWebSocket,
    sandboxId?: string
  ): { replaced: boolean };
  classify(ws: WsWebSocket): ParsedTags;
  getSandboxSocket(): WsWebSocket | null;
  clearSandboxSocket(): void;
  clearSandboxSocketIfMatch(ws: WsWebSocket): boolean;
  setClient(ws: WsWebSocket, info: ClientInfo): void;
  getClient(ws: WsWebSocket): ClientInfo | null;
  removeClient(ws: WsWebSocket): ClientInfo | null;
  send(ws: WsWebSocket, message: string | object): boolean;
  close(ws: WsWebSocket, code: number, reason: string): void;
  forEachClientSocket(
    mode: "all_clients" | "authenticated_only",
    fn: (ws: WsWebSocket) => void
  ): void;
  enforceAuthTimeout(ws: WsWebSocket, wsId: string): Promise<void>;
  getAuthenticatedClients(): IterableIterator<ClientInfo>;
  getConnectedClientCount(): number;
}

export class NodeWebSocketManager implements SessionWebSocketManager {
  private clients = new Map<WsWebSocket, ClientInfo>();
  private sandboxWs: WsWebSocket | null = null;
  // Track all client sockets and their tags
  private clientSockets = new Map<WsWebSocket, { kind: WsKind; id?: string }>();
  private authTimeoutMs: number;

  constructor(authTimeoutMs = 30000) {
    this.authTimeoutMs = authTimeoutMs;
  }

  acceptClientSocket(ws: WsWebSocket, wsId: string): void {
    this.clientSockets.set(ws, { kind: "client", id: wsId });
  }

  acceptAndSetSandboxSocket(
    ws: WsWebSocket,
    sandboxId?: string
  ): { replaced: boolean } {
    this.clientSockets.set(ws, { kind: "sandbox", id: sandboxId });

    let replaced = false;
    if (this.sandboxWs && this.sandboxWs !== ws) {
      try {
        if (this.sandboxWs.readyState === ws.OPEN) {
          this.sandboxWs.close(1000, "New sandbox connecting");
          replaced = true;
        }
      } catch {
        // Ignore
      }
    }

    this.sandboxWs = ws;
    return { replaced };
  }

  classify(ws: WsWebSocket): ParsedTags {
    const tag = this.clientSockets.get(ws);
    if (!tag) return { kind: "client" };
    if (tag.kind === "sandbox") {
      return { kind: "sandbox", sandboxId: tag.id };
    }
    return { kind: "client", wsId: tag.id };
  }

  getSandboxSocket(): WsWebSocket | null {
    if (this.sandboxWs && this.sandboxWs.readyState === this.sandboxWs.OPEN) {
      return this.sandboxWs;
    }
    return null;
  }

  clearSandboxSocket(): void {
    this.sandboxWs = null;
  }

  clearSandboxSocketIfMatch(ws: WsWebSocket): boolean {
    if (this.sandboxWs === ws) {
      this.sandboxWs = null;
      return true;
    }
    return this.sandboxWs === null;
  }

  setClient(ws: WsWebSocket, info: ClientInfo): void {
    this.clients.set(ws, info);
  }

  getClient(ws: WsWebSocket): ClientInfo | null {
    return this.clients.get(ws) ?? null;
  }

  removeClient(ws: WsWebSocket): ClientInfo | null {
    const client = this.clients.get(ws) ?? null;
    this.clients.delete(ws);
    this.clientSockets.delete(ws);
    return client;
  }

  send(ws: WsWebSocket, message: string | object): boolean {
    try {
      if (ws.readyState !== ws.OPEN) return false;
      const data = typeof message === "string" ? message : JSON.stringify(message);
      ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  close(ws: WsWebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed
    }
  }

  forEachClientSocket(
    mode: "all_clients" | "authenticated_only",
    fn: (ws: WsWebSocket) => void
  ): void {
    for (const [ws, tag] of this.clientSockets) {
      if (tag.kind === "sandbox") continue;
      if (ws.readyState !== ws.OPEN) continue;
      if (mode === "authenticated_only" && !this.clients.has(ws)) continue;
      fn(ws);
    }
  }

  async enforceAuthTimeout(ws: WsWebSocket, wsId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.authTimeoutMs));
    if (ws.readyState !== ws.OPEN) return;
    if (this.clients.has(ws)) return;
    this.close(ws, 4008, "Authentication timeout");
  }

  getAuthenticatedClients(): IterableIterator<ClientInfo> {
    return this.clients.values();
  }

  getConnectedClientCount(): number {
    let count = 0;
    for (const [ws, tag] of this.clientSockets) {
      if (tag.kind !== "sandbox" && ws.readyState === ws.OPEN) {
        count++;
      }
    }
    return count;
  }
}
