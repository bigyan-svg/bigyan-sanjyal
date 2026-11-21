export const DOCUMENT_SCROLL_LOCK_ATTRIBUTE = "data-document-scroll-locked";

export interface DocumentScrollViewport {
  scrollX: number;
  scrollY: number;
  scrollTo(options: ScrollToOptions): void;
}

export type DocumentScrollLockTarget = Pick<
  HTMLElement,
  "getAttribute" | "setAttribute" | "removeAttribute"
> & {
  ownerDocument?: { defaultView: DocumentScrollViewport | null };
};

class DocumentScrollLockManager {
  private readonly ownerCounts = new Map<symbol, number>();
  private previousAttribute: string | null = null;
  private previousScrollPosition: {
    viewport: DocumentScrollViewport;
    left: number;
    top: number;
  } | null = null;

  constructor(private readonly root: DocumentScrollLockTarget) {}

  acquire(owner: symbol): () => void {
    if (this.ownerCounts.size === 0) {
      this.previousAttribute = this.root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE);
      const viewport = this.root.ownerDocument?.defaultView;
      this.previousScrollPosition =
        viewport && this.previousAttribute !== "true"
          ? { viewport, left: viewport.scrollX, top: viewport.scrollY }
          : null;
      this.root.setAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE, "true");
    }

    this.ownerCounts.set(owner, (this.ownerCounts.get(owner) ?? 0) + 1);
    let released = false;

    return () => {
      if (released) return;
      released = true;

      const ownerCount = this.ownerCounts.get(owner);
      if (ownerCount === undefined) return;
      if (ownerCount > 1) {
        this.ownerCounts.set(owner, ownerCount - 1);
        return;
      }

      this.ownerCounts.delete(owner);
      if (this.ownerCounts.size > 0) return;

      const previousAttribute = this.previousAttribute;
      const previousScrollPosition = this.previousScrollPosition;
      if (previousAttribute === null) {
        this.root.removeAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE);
      } else {
        this.root.setAttribute(
          DOCUMENT_SCROLL_LOCK_ATTRIBUTE,
          previousAttribute,
        );
      }
      this.previousAttribute = null;
      this.previousScrollPosition = null;

      if (previousAttribute !== "true" && previousScrollPosition) {
        previousScrollPosition.viewport.scrollTo({
          left: previousScrollPosition.left,
          top: previousScrollPosition.top,
          behavior: "instant",
        });
      }
    };
  }
}

const managers = new WeakMap<object, DocumentScrollLockManager>();

function getManager(root: DocumentScrollLockTarget): DocumentScrollLockManager {
  let manager = managers.get(root);
  if (!manager) {
    manager = new DocumentScrollLockManager(root);
    managers.set(root, manager);
  }
  return manager;
}

export function acquireDocumentScrollLock(
  owner: symbol,
  root: DocumentScrollLockTarget = document.documentElement,
): () => void {
  return getManager(root).acquire(owner);
}

export function acquireDocumentScrollLockForEffect(
  active: boolean,
  owner: symbol,
  root?: DocumentScrollLockTarget,
): (() => void) | undefined {
  if (!active) return undefined;
  return acquireDocumentScrollLock(owner, root ?? document.documentElement);
}
