import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireDocumentScrollLockForEffect,
  DOCUMENT_SCROLL_LOCK_ATTRIBUTE,
  type DocumentScrollLockTarget,
  type DocumentScrollViewport,
} from "../src/lib/document-scroll-lock";

class FakeViewport implements DocumentScrollViewport {
  scrollX = 0;
  scrollY = 0;
  scrollCount = 0;

  scrollTo(options: ScrollToOptions): void {
    this.scrollX = options.left ?? this.scrollX;
    this.scrollY = options.top ?? this.scrollY;
    this.scrollCount += 1;
  }
}

class FakeRoot implements DocumentScrollLockTarget {
  private readonly attributes = new Map<string, string>();
  ownerDocument: { defaultView: FakeViewport | null };
  readonly style = { overflow: "auto" };

  constructor(viewport = new FakeViewport()) {
    this.ownerDocument = { defaultView: viewport };
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

test("a single owner locks and then releases document scrolling", () => {
  const root = new FakeRoot();
  const release = acquireDocumentScrollLockForEffect(true, Symbol("header"), root);

  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");
  release?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
});

test("inactive effects do not acquire a lock", () => {
  const root = new FakeRoot();
  const release = acquireDocumentScrollLockForEffect(false, Symbol("header"), root);

  assert.equal(release, undefined);
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
});

test("independent owners keep scrolling locked until the final release", () => {
  const viewport = new FakeViewport();
  viewport.scrollX = 36;
  viewport.scrollY = 640;
  const root = new FakeRoot(viewport);
  const releaseHeader = acquireDocumentScrollLockForEffect(true, Symbol("header"), root);
  const releaseGallery = acquireDocumentScrollLockForEffect(true, Symbol("gallery"), root);
  const releaseAdmin = acquireDocumentScrollLockForEffect(true, Symbol("admin"), root);

  viewport.scrollTo({ left: 0, top: 0, behavior: "instant" });
  releaseGallery?.();
  releaseHeader?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");
  assert.equal(viewport.scrollX, 0);
  assert.equal(viewport.scrollY, 0);

  releaseAdmin?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
  assert.equal(viewport.scrollX, 36);
  assert.equal(viewport.scrollY, 640);
});

test("locks released in either order remain active until both owners release", () => {
  for (const order of [[0, 1], [1, 0]]) {
    const root = new FakeRoot();
    const releases = [
      acquireDocumentScrollLockForEffect(true, Symbol("first"), root),
      acquireDocumentScrollLockForEffect(true, Symbol("second"), root),
    ];

    releases[order[0]]?.();
    assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");
    releases[order[1]]?.();
    assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
  }
});

test("repeated acquisition by one owner and duplicate cleanup are safe", () => {
  const root = new FakeRoot();
  const owner = Symbol("same-owner");
  const releaseFirst = acquireDocumentScrollLockForEffect(true, owner, root);
  const releaseSecond = acquireDocumentScrollLockForEffect(true, owner, root);

  releaseFirst?.();
  releaseFirst?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");

  releaseSecond?.();
  releaseSecond?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
});

test("effect cleanup releases a component lock on close or unmount", () => {
  const root = new FakeRoot();
  const release = acquireDocumentScrollLockForEffect(true, Symbol("component"), root);

  release?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
});

test("pre-existing lock marker and root inline overflow are preserved", () => {
  const viewport = new FakeViewport();
  viewport.scrollY = 480;
  const root = new FakeRoot(viewport);
  root.setAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE, "pre-existing");
  root.style.overflow = "scroll";
  const release = acquireDocumentScrollLockForEffect(true, Symbol("header"), root);

  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");
  assert.equal(root.style.overflow, "scroll");

  release?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "pre-existing");
  assert.equal(root.style.overflow, "scroll");
  assert.equal(viewport.scrollY, 480);
});

test("a document already locked by another owner is not scrolled on release", () => {
  const viewport = new FakeViewport();
  viewport.scrollY = 480;
  const root = new FakeRoot(viewport);
  root.setAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE, "true");
  const release = acquireDocumentScrollLockForEffect(true, Symbol("header"), root);

  viewport.scrollTo({ top: 0, behavior: "instant" });
  release?.();

  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");
  assert.equal(viewport.scrollY, 0);
});

test("navigation, gallery, and admin owners release independently", () => {
  const root = new FakeRoot();
  const releaseNavigation = acquireDocumentScrollLockForEffect(true, Symbol("site-navigation"), root);
  const releaseGallery = acquireDocumentScrollLockForEffect(true, Symbol("project-gallery"), root);
  const releaseAdmin = acquireDocumentScrollLockForEffect(true, Symbol("admin-drawer"), root);

  releaseAdmin?.();
  releaseGallery?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), "true");

  releaseNavigation?.();
  assert.equal(root.getAttribute(DOCUMENT_SCROLL_LOCK_ATTRIBUTE), null);
});
