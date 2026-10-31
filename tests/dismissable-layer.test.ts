import assert from "node:assert/strict";
import { test } from "node:test";
import { DismissableLayerManager } from "../src/lib/dismissable-layer-manager";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "../src/lib/unsaved-changes";

function layer(
  id: symbol,
  insideElements: Array<HTMLElement | null>,
  onOutsideClick: () => void,
  onEscape?: () => void,
) {
  return { id, getInsideElements: () => insideElements, onOutsideClick, onEscape };
}

function pointerDown(...path: EventTarget[]) {
  return {
    target: path[0] ?? null,
    composedPath: () => path,
  };
}

test("outside pointer events close only the topmost layer", () => {
  const manager = new DismissableLayerManager();
  const parentContent = new EventTarget() as unknown as HTMLElement;
  const childContent = new EventTarget() as unknown as HTMLElement;
  let parentDismissals = 0;
  let childDismissals = 0;

  manager.register(layer(Symbol("parent"), [parentContent], () => { parentDismissals += 1; }));
  const removeChild = manager.register(layer(Symbol("child"), [childContent], () => { childDismissals += 1; }));

  manager.handlePointerDown(pointerDown(new EventTarget()));

  assert.equal(childDismissals, 1);
  assert.equal(parentDismissals, 0);

  manager.handlePointerDown(pointerDown(parentContent));
  assert.equal(childDismissals, 2);
  assert.equal(parentDismissals, 0);

  removeChild();
  manager.handlePointerDown(pointerDown(parentContent));
  assert.equal(parentDismissals, 0);
});

test("clicks inside a layer and its portaled content do not dismiss it", () => {
  const manager = new DismissableLayerManager();
  const panel = new EventTarget() as unknown as HTMLElement;
  const portal = new EventTarget() as unknown as HTMLElement;
  let dismissals = 0;
  manager.register(layer(Symbol("panel"), [panel, portal], () => { dismissals += 1; }));

  manager.handlePointerDown(pointerDown(new EventTarget(), portal));
  manager.handlePointerDown(pointerDown(panel));

  assert.equal(dismissals, 0);
});

test("lightbox layout gaps and all viewport edges dismiss, while image and controls stay inside", () => {
  const manager = new DismissableLayerManager();
  const dialog = new EventTarget();
  const panel = new EventTarget();
  const stage = new EventTarget();
  const figure = new EventTarget();
  const image = new EventTarget() as unknown as HTMLElement;
  const caption = new EventTarget() as unknown as HTMLElement;
  const title = new EventTarget() as unknown as HTMLElement;
  const counter = new EventTarget() as unknown as HTMLElement;
  const closeButton = new EventTarget() as unknown as HTMLElement;
  const previousButton = new EventTarget() as unknown as HTMLElement;
  const nextButton = new EventTarget() as unknown as HTMLElement;
  let dismissals = 0;

  manager.register(layer(
    Symbol("lightbox-content"),
    [image, caption, title, counter, closeButton, previousButton, nextButton],
    () => { dismissals += 1; },
  ));

  const outsideAreas = [
    { name: "above image", path: [new EventTarget(), figure, stage, panel, dialog] },
    { name: "below image", path: [new EventTarget(), figure, stage, panel, dialog] },
    { name: "left of image", path: [new EventTarget(), stage, panel, dialog] },
    { name: "right of image", path: [new EventTarget(), stage, panel, dialog] },
    { name: "top left corner", path: [new EventTarget(), dialog] },
    { name: "top right corner", path: [new EventTarget(), dialog] },
    { name: "bottom left corner", path: [new EventTarget(), dialog] },
    { name: "bottom right corner", path: [new EventTarget(), dialog] },
  ];
  for (const area of outsideAreas) {
    assert.ok(area.name.length > 0);
    manager.handlePointerDown(pointerDown(...area.path));
  }
  assert.equal(dismissals, outsideAreas.length);

  for (const insideElement of [image, caption, title, counter, closeButton, previousButton, nextButton]) {
    manager.handlePointerDown(pointerDown(insideElement, figure, stage, panel, dialog));
  }
  assert.equal(dismissals, outsideAreas.length);
});

test("Escape dismisses only the topmost layer and prevents native parent dismissal", () => {
  const manager = new DismissableLayerManager();
  const inside = new EventTarget() as unknown as HTMLElement;
  let parentDismissals = 0;
  let childDismissals = 0;

  manager.register(layer(Symbol("parent"), [inside], () => {}, () => { parentDismissals += 1; }));
  const removeChild = manager.register(layer(Symbol("child"), [inside], () => {}, () => { childDismissals += 1; }));
  let prevented = false;
  let stopped = false;

  manager.handleKeyDown({
    key: "Escape",
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });

  assert.equal(childDismissals, 1);
  assert.equal(parentDismissals, 0);
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  removeChild();
  manager.handleKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(parentDismissals, 1);
});

test("an Escape-opaque top layer does not dismiss a lower layer", () => {
  const manager = new DismissableLayerManager();
  const inside = new EventTarget() as unknown as HTMLElement;
  let parentDismissals = 0;

  manager.register(layer(Symbol("parent"), [inside], () => {}, () => { parentDismissals += 1; }));
  manager.register(layer(Symbol("native-dialog"), [inside], () => {}));
  manager.handleKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });

  assert.equal(parentDismissals, 0);
});

test("discard confirmation is skipped for unchanged forms and honors the user's choice", () => {
  let prompts = 0;
  const confirmDiscard = () => {
    prompts += 1;
    return false;
  };

  assert.equal(confirmDiscardIfDirty(false, confirmDiscard), true);
  assert.equal(prompts, 0);
  assert.equal(confirmDiscardIfDirty(true, confirmDiscard), false);
  assert.equal(prompts, 1);
  assert.equal(confirmDiscardIfDirty(true, () => true), true);
});

test("form snapshots become clean again when values are restored", () => {
  const initial = { title: "Project", links: [{ label: "Demo", url: "https://example.test" }] };
  const changed = { ...initial, title: "Updated project" };
  const restored = { title: "Project", links: [{ label: "Demo", url: "https://example.test" }] };

  assert.equal(hasUnsavedChanges(initial, changed), true);
  assert.equal(hasUnsavedChanges(initial, restored), false);
});
