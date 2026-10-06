"use client";

import { useEffect, useRef, useState } from "react";

export type PortalPhoto = {
  id: string;
  src: string;
  alt: string;
};

export function PhotoLightbox({ photos }: { photos: PortalPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (index != null) {
      wasOpen.current = true;
      closeRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      returnFocus.current?.focus();
    }
  }, [index]);

  useEffect(() => {
    if (index == null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIndex(null);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => (current == null ? current : (current + 1) % photos.length));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => (current == null ? current : (current - 1 + photos.length) % photos.length));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length]);

  if (photos.length === 0) return null;
  const current = index != null ? photos[index] : null;

  return (
    <>
      <ul className="home-photos">
        {photos.map((photo, photoIndex) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setIndex(photoIndex);
              }}
            >
              <img src={photo.src} alt="" />
              <span>{photo.alt || "Photo"}</span>
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="home-lightbox" role="dialog" aria-modal="true" aria-label="Photo">
          <button ref={closeRef} type="button" className="home-lightbox-close" onClick={() => setIndex(null)}>
            Close
          </button>
          <img src={current.src} alt={current.alt || "Photo"} />
          {photos.length > 1 ? (
            <div className="home-lightbox-nav">
              <button type="button" onClick={() => setIndex((currentIndex) => (currentIndex == null ? 0 : (currentIndex - 1 + photos.length) % photos.length))}>
                Previous
              </button>
              <button type="button" onClick={() => setIndex((currentIndex) => (currentIndex == null ? 0 : (currentIndex + 1) % photos.length))}>
                Next
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
