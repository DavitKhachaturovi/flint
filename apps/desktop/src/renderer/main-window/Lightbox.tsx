import { useEffect, useRef, useState, type ReactElement } from 'react';
import { imageMenuItems } from '../media/media.js';
import { openMenu } from '../menu/menu.js';
import { ChevronIcon, CloseIcon } from './icons.js';

/** A duration token in ms (09 §9); 0 under reduce-motion, when nothing animates. */
function durationMs(token: string, fallback: number): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The image lightbox (MEDIA-01, D-77, D-79): one task's images, large, on the window's ground. It
 * opens and closes with a short fade and scale; ←/→ go through the same task's images (never other
 * tasks'), Esc or a click outside the image closes it. While it is open it takes every key, so
 * nothing behind it moves.
 */
export function Lightbox(props: {
  readonly images: readonly string[];
  readonly start: number;
  readonly onClose: () => void;
}): ReactElement {
  const { images, start, onClose } = props;
  const [index, setIndex] = useState(start);
  const [step, setStep] = useState<'next' | 'back' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const closing = useRef(false);
  const count = images.length;

  const close = (): void => {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    window.setTimeout(onClose, durationMs('--fl-dur-base', 200));
  };
  const go = (by: 1 | -1): void => {
    if (count < 2) return;
    setStep(by === 1 ? 'next' : 'back');
    setIndex((current) => (current + by + count) % count);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        go(event.key === 'ArrowRight' ? 1 : -1);
      } else if (!event.ctrlKey || event.key.toLowerCase() !== 'c') {
        // Copy still works; nothing else reaches the window behind.
        event.preventDefault();
      }
    };
    // Capture phase: before the main window's own keys (Esc going back, the arrows moving).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const src = images[index] ?? '';
  return (
    <div
      className={leaving ? 'lightbox leaving' : 'lightbox'}
      role="dialog"
      aria-modal="true"
      aria-label="Image"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (!(event.target as Element).closest('img, button')) close();
      }}
      // MEDIA-02, D-87: the picture's menu (it is already in the viewer).
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (src !== '') openMenu(imageMenuItems(src), { x: event.clientX, y: event.clientY });
      }}
    >
      <img
        key={index}
        className={step ? `lightbox-image ${step}` : 'lightbox-image'}
        src={src}
        alt=""
        draggable={false}
      />
      <button type="button" className="lightbox-close" title="Close (Esc)" onClick={close}>
        <CloseIcon size={16} />
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-step back"
            title="Previous image (←)"
            onClick={() => go(-1)}
          >
            <ChevronIcon size={18} />
          </button>
          <button
            type="button"
            className="lightbox-step next"
            title="Next image (→)"
            onClick={() => go(1)}
          >
            <ChevronIcon size={18} />
          </button>
          <span className="lightbox-count">
            {index + 1} / {count}
          </span>
        </>
      )}
    </div>
  );
}
