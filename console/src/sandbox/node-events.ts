type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();
  setMaxListeners(_n: number) {
    return this;
  }
  on(name: string, fn: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
    return this;
  }
  off(name: string, fn: Listener) {
    this.listeners.get(name)?.delete(fn);
    return this;
  }
  emit(name: string, ...args: unknown[]) {
    const set = this.listeners.get(name);
    for (const fn of set ?? []) fn(...args);
    return Boolean(set?.size);
  }
}
