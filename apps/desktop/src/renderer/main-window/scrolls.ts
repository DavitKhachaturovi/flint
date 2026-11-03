import { useLayoutEffect, type RefObject } from 'react';

/**
 * D-93: a column that scrolls on its own (the context panel, Today's column) shows its scrollbar,
 * and scrolls, only while its content is really taller than it (`scrolls`): never for a sub-pixel
 * remainder (an image's rounded height made the panel scroll by a pixel, its scrollbar narrowing
 * the content as it appeared) or for a section rising into place. Checked when it or its children
 * change size, gain or lose children, or finish an animation.
 */
export function useScrollsWhenTaller(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = (): void => {
      element.classList.toggle('scrolls', element.scrollHeight - element.clientHeight > 2);
    };
    const sizes = new ResizeObserver(check);
    const watch = (): void => {
      sizes.disconnect();
      sizes.observe(element);
      for (const child of element.children) sizes.observe(child);
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(element, { childList: true });
    element.addEventListener('animationend', check);
    element.addEventListener('transitionend', check);
    check();
    return () => {
      sizes.disconnect();
      children.disconnect();
      element.removeEventListener('animationend', check);
      element.removeEventListener('transitionend', check);
    };
  }, [ref]);
}
