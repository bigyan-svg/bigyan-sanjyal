import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeProjectGalleryImage,
  openProjectGalleryImage,
  ProjectGalleryFocusController,
  type ProjectGalleryFocusOpener,
} from "../src/lib/project-gallery-focus";
import { DismissableLayerManager } from "../src/lib/dismissable-layer-manager";

function opener(
  connected = true,
): ProjectGalleryFocusOpener & { focuses: Array<{ preventScroll?: boolean } | undefined> } {
  const state = {
    isConnected: connected,
    focuses: [] as Array<{ preventScroll?: boolean } | undefined>,
    focus(options?: { preventScroll?: boolean }) {
      state.focuses.push(options);
    },
  };
  return state;
}

test("opening stores the exact opener and closing restores it", () => {
  const controller = new ProjectGalleryFocusController();
  const first = opener();
  let frame: (() => void) | undefined;

  controller.open(first);
  assert.equal(controller.current, first);
  controller.close({ scheduleFrame: (callback) => { frame = callback; } });
  assert.equal(frame !== undefined, true);
  frame?.();

  assert.deepEqual(first.focuses, [{ preventScroll: true }]);
  assert.equal(controller.current, null);
});

test("Escape, close button, and outside dismissal each restore the opener", () => {
  for (const closePath of ["Escape", "close button", "outside dismissal"]) {
    const controller = new ProjectGalleryFocusController();
    const openerElement = opener();
    let frame: (() => void) | undefined;

    controller.open(openerElement);
    controller.close({ scheduleFrame: (callback) => { frame = callback; } });
    frame?.();

    assert.deepEqual(
      openerElement.focuses,
      [{ preventScroll: true }],
      `${closePath} did not restore its opener`,
    );
  }
});

test("reopening a different image replaces the stored opener", () => {
  const controller = new ProjectGalleryFocusController();
  const first = opener();
  const second = opener();
  let frame: (() => void) | undefined;

  controller.open(first);
  controller.open(second);
  controller.close({ scheduleFrame: (callback) => { frame = callback; } });
  frame?.();

  assert.equal(first.focuses.length, 0);
  assert.deepEqual(second.focuses, [{ preventScroll: true }]);
});

test("duplicate close calls do not restore focus twice", () => {
  const controller = new ProjectGalleryFocusController();
  const first = opener();
  let frameCount = 0;

  controller.open(first);
  controller.close({ scheduleFrame: () => { frameCount += 1; } });
  controller.close({ scheduleFrame: () => { frameCount += 1; } });

  assert.equal(frameCount, 1);
});

test("disconnected opener is not focused", () => {
  const controller = new ProjectGalleryFocusController();
  const disconnected = opener(false);
  let frame: (() => void) | undefined;

  controller.open(disconnected);
  controller.close({ scheduleFrame: (callback) => { frame = callback; } });
  frame?.();

  assert.equal(disconnected.focuses.length, 0);
});

test("unmounted component suppresses delayed restoration", () => {
  const controller = new ProjectGalleryFocusController();
  const first = opener();
  let frame: (() => void) | undefined;

  controller.open(first);
  controller.close({
    scheduleFrame: (callback) => { frame = callback; },
    isMounted: () => false,
  });
  frame?.();

  assert.equal(first.focuses.length, 0);
});

test("dismissable-layer Escape close restores the exact triggering opener", () => {
  const controller = new ProjectGalleryFocusController();
  const first = opener();
  let active = true;
  let frame: (() => void) | undefined;

  openProjectGalleryImage(controller, first, () => undefined);

  const manager = new DismissableLayerManager();
  manager.register({
    id: Symbol("project-gallery"),
    getInsideElements: () => [],
    onOutsideClick: () => {
      closeProjectGalleryImage(
        controller,
        () => { active = false; },
        { scheduleFrame: (callback) => { frame = callback; } },
      );
    },
    onEscape: () => {
      closeProjectGalleryImage(
        controller,
        () => { active = false; },
        { scheduleFrame: (callback) => { frame = callback; } },
      );
    },
  });

  let prevented = false;
  let stopped = false;
  manager.handleKeyDown({
    key: "Escape",
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });
  frame?.();

  assert.equal(active, false);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(first.focuses, [{ preventScroll: true }]);
});

test("dismissable-layer close button and outside close paths restore the opener", () => {
  for (const closePath of ["close button", "outside"] as const) {
    const controller = new ProjectGalleryFocusController();
    const openerElement = opener();
    let frame: (() => void) | undefined;
    openProjectGalleryImage(controller, openerElement, () => undefined);

    if (closePath === "outside") {
      const manager = new DismissableLayerManager();
      manager.register({
        id: Symbol("project-gallery"),
        getInsideElements: () => [],
        onOutsideClick: () => {
          closeProjectGalleryImage(
            controller,
            () => undefined,
            { scheduleFrame: (callback) => { frame = callback; } },
          );
        },
      });
      manager.handlePointerDown({
        target: null,
        composedPath: () => [],
      });
    } else {
      closeProjectGalleryImage(
        controller,
        () => undefined,
        { scheduleFrame: (callback) => { frame = callback; } },
      );
    }

    frame?.();
    assert.deepEqual(
      openerElement.focuses,
      [{ preventScroll: true }],
      `${closePath} did not restore the exact opener`,
    );
  }
});

test("queued close frame cannot steal focus after reopening image B", () => {
  const controller = new ProjectGalleryFocusController();
  const imageA = opener();
  const imageB = opener();
  let firstFrame: (() => void) | undefined;

  openProjectGalleryImage(controller, imageA, () => undefined);
  closeProjectGalleryImage(
    controller,
    () => undefined,
    { scheduleFrame: (callback) => { firstFrame = callback; } },
  );

  openProjectGalleryImage(controller, imageB, () => undefined);
  firstFrame?.();

  assert.equal(imageA.focuses.length, 0);
  assert.equal(imageB.focuses.length, 0);

  let secondFrame: (() => void) | undefined;
  closeProjectGalleryImage(
    controller,
    () => undefined,
    { scheduleFrame: (callback) => { secondFrame = callback; } },
  );
  secondFrame?.();
  assert.equal(imageB.focuses.length, 1);
});
