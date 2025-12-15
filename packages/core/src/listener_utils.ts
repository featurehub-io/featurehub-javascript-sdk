export class ListenerUtils {
  public static newListenerKey(where: Map<number, any>): number {
    // find a unique slot, we can't keep a counter as we can bump from context to context
    // and placeholder to real
    let pos = Math.round(Math.random() * 10000);

    while (where.has(pos)) {
      pos = Math.round(Math.random() * 10000);
    }

    return pos;
  }

  public static removeListener(listeners: Map<number, any>, listener: any) {
    if (typeof listener == "number") {
      if (listeners.has(listener)) {
        listeners.delete(listener);
      }
    } else {
      const key = [...listeners.entries()].find(({ 1: val }) => val == listener);

      if (key) {
        listeners.delete(key[0]);
      }
    }
  }
}
