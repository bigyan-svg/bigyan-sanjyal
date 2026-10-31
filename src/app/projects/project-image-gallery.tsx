"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { useDismissableLayer } from "@/hooks/use-dismissable-layer";

interface ProjectGalleryImage {
  id: string;
  imageUrl: string;
  altText: string;
  caption: string | null;
}

interface ProjectImageGalleryProps {
  projectTitle: string;
  images: ProjectGalleryImage[];
}

export function ProjectImageGallery({ projectTitle, images }: ProjectImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const captionRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const counterTextRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const instructionsId = useId();
  const isOpen = activeIndex !== null;
  const activeImage = activeIndex === null ? null : (images[activeIndex] ?? null);

  useDismissableLayer({
    enabled: isOpen,
    insideRefs: [
      imageRef,
      closeButtonRef,
      previousButtonRef,
      nextButtonRef,
      captionRef,
      titleRef,
      counterTextRef,
    ],
    onOutsideClick: closeLightbox,
  });

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [isOpen]);

  function closeLightbox() {
    setActiveIndex(null);
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeLightbox();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (activeIndex === null || images.length < 2) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((index) => index === null ? 0 : (index - 1 + images.length) % images.length);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((index) => index === null ? 0 : (index + 1) % images.length);
    }
  }

  return (
    <>
      <div className="public-projects__images">
        {images.map((image, index) => (
          <figure className="public-projects__image" key={image.id}>
            <button
              aria-label={`View image ${index + 1} of ${images.length} for ${projectTitle}: ${image.altText}`}
              className="public-projects__image-open"
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              {/* Validated HTTPS images bypass Next's optimizer to avoid proxying arbitrary hosts. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                decoding="async"
                loading="lazy"
                referrerPolicy="no-referrer"
                src={image.imageUrl}
              />
            </button>
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
            {index === 0 ? <span className="public-projects__primary-image">Primary image</span> : null}
          </figure>
        ))}
      </div>

      <dialog
        aria-describedby={instructionsId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="project-lightbox"
        onCancel={handleCancel}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
      >
        <div className="project-lightbox__panel">
          <div className="project-lightbox__toolbar">
            <h2 className="project-lightbox__title" id={titleId} ref={titleRef}>{projectTitle}</h2>
            <button
              aria-label="Close image viewer"
              className="project-lightbox__control project-lightbox__close"
              onClick={closeLightbox}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={22} />
            </button>
          </div>

          {activeImage && activeIndex !== null ? (
            <div className="project-lightbox__stage">
              {images.length > 1 ? (
                <button
                  aria-label="Previous image"
                  className="project-lightbox__control"
                  onClick={() => setActiveIndex((activeIndex - 1 + images.length) % images.length)}
                  ref={previousButtonRef}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={24} />
                </button>
              ) : null}

              <figure className="project-lightbox__figure" key={activeImage.id}>
                {/* This validated HTTPS image stays direct to avoid proxying arbitrary hosts through Next's optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={activeImage.altText}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  ref={imageRef}
                  src={activeImage.imageUrl}
                />
                {activeImage.caption ? (
                  <figcaption><span ref={captionRef}>{activeImage.caption}</span></figcaption>
                ) : null}
              </figure>

              {images.length > 1 ? (
                <button
                  aria-label="Next image"
                  className="project-lightbox__control"
                  onClick={() => setActiveIndex((activeIndex + 1) % images.length)}
                  ref={nextButtonRef}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={24} />
                </button>
              ) : null}
            </div>
          ) : null}

          <p aria-live="polite" className="project-lightbox__counter">
            <span ref={counterTextRef}>
              {activeIndex === null ? "" : `Image ${activeIndex + 1} of ${images.length}`}
            </span>
          </p>
          <p className="sr-only" id={instructionsId}>
            {images.length > 1
              ? "Use the left and right arrow keys or previous and next buttons to browse images. Press Escape to close."
              : "Press Escape to close."}
          </p>
        </div>
      </dialog>
    </>
  );
}
