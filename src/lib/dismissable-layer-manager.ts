export interface DismissableLayerRegistration {
  id: symbol;
  getInsideElements: () => readonly (HTMLElement | null)[];
  onOutsideClick: () => void;
  onEscape?: () => void;
}

export class DismissableLayerManager {
  private readonly layers: DismissableLayerRegistration[] = [];

  get size(): number {
    return this.layers.length;
  }

  register(layer: DismissableLayerRegistration): () => void {
    this.layers.push(layer);

    return () => {
      const index = this.layers.findIndex((item) => item.id === layer.id);
      if (index >= 0) this.layers.splice(index, 1);
    };
  }

  handlePointerDown(event: Pick<PointerEvent, "composedPath" | "target">): void {
    const topLayer = this.layers.at(-1);
    if (!topLayer) return;

    const path = event.composedPath();
    const target = event.target as (Node & { nodeType?: number }) | null;
    const isInside = topLayer.getInsideElements().some((element) => {
      if (!element) return false;
      if (path.includes(element)) return true;
      return Boolean(target?.nodeType && element.contains(target));
    });

    if (!isInside) topLayer.onOutsideClick();
  }

  handleKeyDown(event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">): void {
    if (event.key !== "Escape") return;

    const topLayer = this.layers.at(-1);
    if (!topLayer?.onEscape) return;

    event.preventDefault();
    event.stopPropagation();
    topLayer.onEscape();
  }
}
