// Tracks the last successful API exchange and the last failed request so the
// "Connection interrupted" screen (web-54) can show real data and retry the failed request.
import type { ApiError } from './client';

const STORAGE_KEY = 'rg.lastSync';

export interface FailedRequest {
  method: string;
  path: string;
  error: ApiError;
  at: string;
}

export interface ConnectivitySnapshot {
  lastSuccessAt: string | null;
  lastFailure: FailedRequest | null;
  online: boolean;
}

type Listener = (s: ConnectivitySnapshot) => void;

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

class Connectivity {
  private lastSuccessAt: string | null = readStored();
  private lastFailure: FailedRequest | null = null;
  private online = true;
  private listeners = new Set<Listener>();
  private lastPersist = 0;

  snapshot(): ConnectivitySnapshot {
    return { lastSuccessAt: this.lastSuccessAt, lastFailure: this.lastFailure, online: this.online };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  markSuccess(): void {
    const now = new Date();
    this.lastSuccessAt = now.toISOString();
    const changed = !this.online;
    this.online = true;
    // Throttle storage writes; keep memory exact.
    if (now.getTime() - this.lastPersist > 5_000) {
      this.lastPersist = now.getTime();
      try {
        localStorage.setItem(STORAGE_KEY, this.lastSuccessAt);
      } catch {
        /* storage unavailable */
      }
    }
    if (changed) this.emit();
  }

  markFailure(f: Omit<FailedRequest, 'at'>): void {
    this.lastFailure = { ...f, at: new Date().toISOString() };
    this.online = false;
    this.emit();
  }

  clearFailure(): void {
    this.lastFailure = null;
    this.emit();
  }

  private emit(): void {
    const s = this.snapshot();
    this.listeners.forEach((l) => l(s));
  }
}

export const connectivity = new Connectivity();
