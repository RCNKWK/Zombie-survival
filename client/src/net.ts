import type { ClientMsg, ErrorCode, ServerMsg } from '../../shared/protocol.js';

export interface NetCallbacks {
  onWelcome: (msg: Extract<ServerMsg, { t: 'welcome' }>) => void;
  onSnap: (msg: Extract<ServerMsg, { t: 'snap' }>) => void;
  onSaved: (at: number) => void;
  onWorldClosing: (inSec: number) => void;
  onError: (code: ErrorCode, msg: string) => void;
  onLatency: (ms: number) => void;
  onConnectionState: (state: 'connecting' | 'open' | 'reconnecting') => void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000];

export class NetClient {
  private readonly worldId: string;
  private launchToken: string | null;
  private readonly cb: NetCallbacks;

  private ws: WebSocket | null = null;
  private resumeToken: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pingSentAt = 0;
  private pingSeq = 1;
  private closedByError = false;
  private disposed = false;

  constructor(worldId: string, launchToken: string | null, cb: NetCallbacks) {
    this.worldId = worldId;
    this.launchToken = launchToken;
    this.cb = cb;

    try {
      this.resumeToken = sessionStorage.getItem(`dz_rt_${worldId}`);
    } catch {
      this.resumeToken = null;
    }
  }

  connect() {
    if (this.disposed) return;
    this.closedByError = false;
    this.cb.onConnectionState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const envWs = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = envWs && envWs.length > 0 ? envWs.replace(/\/+$/, '') : `${proto}//${location.host}/ws`;
    const url = `${base}?world=${encodeURIComponent(this.worldId)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.cb.onConnectionState('open');
      if (this.launchToken) {
        this.send({ t: 'join', token: this.launchToken });
        this.launchToken = null;
      } else if (this.resumeToken) {
        this.send({ t: 'resume', rt: this.resumeToken });
      } else {
        this.closedByError = true;
        this.cb.onError('relaunch', 'Missing launch token. Please open the world from the lobby.');
        ws.close();
      }
      this.startPing();
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'welcome':
          this.resumeToken = msg.rt;
          try {
            sessionStorage.setItem(`dz_rt_${this.worldId}`, msg.rt);
          } catch {
            // ignore storage block in strict private mode
          }
          this.cb.onWelcome(msg);
          break;
        case 'snap':
          this.cb.onSnap(msg);
          break;
        case 'saved':
          this.cb.onSaved(msg.at);
          break;
        case 'worldClosing':
          this.cb.onWorldClosing(msg.inSec);
          break;
        case 'error':
          this.closedByError = true;
          if (msg.code === 'relaunch') {
            this.resumeToken = null;
            try {
              sessionStorage.removeItem(`dz_rt_${this.worldId}`);
            } catch {
              // ignore
            }
          }
          this.cb.onError(msg.code, msg.msg);
          break;
        case 'pong':
          if (msg.c === this.pingSeq - 1) {
            this.cb.onLatency(Math.round(performance.now() - this.pingSentAt));
          }
          break;
      }
    };

    ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      if (!this.disposed && !this.closedByError) {
        const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)]!;
        this.reconnectAttempt++;
        this.cb.onConnectionState('reconnecting');
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      }
    };
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.pingSentAt = performance.now();
        this.send({ t: 'ping', c: this.pingSeq++ });
      }
    }, 2000);
  }

  private stopPing() {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  dispose() {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
