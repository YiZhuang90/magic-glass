// 极简事件总线：各层之间只通过事件通信，便于后续接入混色模式与教学层。
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type).delete(fn);
  }
  emit(type, payload) {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error(e); } }
  }
}
export const bus = new EventBus();
