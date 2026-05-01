type Listener<T> = (payload: T) => void;

export class TypedEventEmitter<EventMap extends object> {
  private listeners = new Map<keyof EventMap, Set<Listener<any>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) { bucket = new Set(); this.listeners.set(event, bucket); }
    bucket.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>) {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const l of bucket) l(payload);
  }

  clear() { this.listeners.clear(); }
}
