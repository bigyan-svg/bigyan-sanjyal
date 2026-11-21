export interface ProjectGalleryFocusOpener {
  readonly isConnected: boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface ProjectGalleryFocusOptions {
  scheduleFrame?: (callback: () => void) => void;
  isMounted?: () => boolean;
}

export function openProjectGalleryImage(
  controller: ProjectGalleryFocusController,
  opener: ProjectGalleryFocusOpener,
  open: () => void,
): void {
  controller.open(opener);
  open();
}

export function closeProjectGalleryImage(
  controller: ProjectGalleryFocusController,
  close: () => void,
  options: ProjectGalleryFocusOptions = {},
): void {
  if (!controller.current) return;
  close();
  controller.close(options);
}

export class ProjectGalleryFocusController {
  private opener: ProjectGalleryFocusOpener | null = null;
  private generation = 0;

  open(opener: ProjectGalleryFocusOpener): void {
    this.generation += 1;
    this.opener = opener;
  }

  close(options: ProjectGalleryFocusOptions = {}): void {
    const opener = this.opener;
    if (!opener) return;
    const generation = this.generation;
    this.opener = null;

    const scheduleFrame = options.scheduleFrame ??
      ((callback) => {
        if (
          typeof window !== "undefined" &&
          typeof window.requestAnimationFrame === "function"
        ) {
          window.requestAnimationFrame(callback);
        } else {
          callback();
        }
      });

    scheduleFrame(() => {
      if (options.isMounted && !options.isMounted()) return;
      if (this.generation !== generation) return;
      if (!opener.isConnected) return;
      opener.focus({ preventScroll: true });
    });
  }

  clear(): void {
    this.generation += 1;
    this.opener = null;
  }

  get current(): ProjectGalleryFocusOpener | null {
    return this.opener;
  }
}
