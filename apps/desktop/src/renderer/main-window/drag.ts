/**
 * The locked, springy drag (TASK-01, LIST-05, LIST-06, D-54, D-78): the dragged item follows the
 * pointer on the vertical axis only and never leaves its list; the others slide out of its way with
 * the spring. It works on the DOM directly (transforms only, no re-render while dragging); after the
 * drop the item waits in its new slot until the list re-renders in the new order, then the
 * transforms go, so nothing jumps.
 */

/** One draggable item: the elements that move together (a task and its subtasks, a group). */
export interface DragUnit {
  readonly key: string;
  readonly elements: readonly HTMLElement[];
}

export interface DragSetup {
  /** What is dragged; the drag starts only past a small threshold. */
  readonly unit: DragUnit;
  /** Every item it moves among, in order, the dragged one included. */
  readonly peers: readonly DragUnit[];
  /** Positioned ancestor that scrolls the list (for auto-scroll near its edges). */
  readonly scroller: HTMLElement | null;
  /** Called once the threshold is passed; false cancels the drag (a sort is active). */
  readonly canStart?: () => boolean;
  /** Before measuring: e.g. an expanded task folds while it is dragged. */
  readonly onLift?: () => void;
  /** After the drag ends, whatever happened. */
  readonly onSettle?: () => void;
  /**
   * The drop: `index` among the peers without the dragged one, `offset` how far between its two
   * neighbours' middles the dragged item's leading edge is (0 to 1), for drops into or out of a group.
   * Resolves true when the change was made (the list will re-render in the new order).
   */
  readonly onDrop: (index: number, offset: number) => Promise<boolean>;
  /** While dragging, after each move: `index` and `offset` as for the drop. */
  readonly onOver?: (index: number, offset: number) => void;
}

const THRESHOLD = 4;
const EDGE = 40;

interface Box {
  readonly top: number;
  readonly bottom: number;
}

const boxOf = (elements: readonly HTMLElement[]): Box => {
  let top = Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { top, bottom };
};

const setShift = (unit: DragUnit, by: number): void => {
  for (const element of unit.elements) element.style.transform = by ? `translateY(${by}px)` : '';
};

const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Starts watching a mouse press for a drag. Call it from `mousedown` (left button, no modifiers);
 * a press that never moves past the threshold stays a click.
 */
export function watchDrag(start: MouseEvent, setup: DragSetup): void {
  const startY = start.clientY;
  let lastY = startY;
  let active = false;
  let frame = 0;
  // Measured once lifted, relative to the scroller's content (so auto-scroll keeps them valid).
  let scrollAt = 0;
  let boxes: Box[] = [];
  let self = -1;
  let span = 0;
  let index = -1;
  let offset = 0;

  const scrollTop = (): number => setup.scroller?.scrollTop ?? 0;

  const lift = (): boolean => {
    if (setup.canStart && !setup.canStart()) return false;
    setup.onLift?.();
    self = setup.peers.findIndex((peer) => peer.key === setup.unit.key);
    if (self < 0) return false;
    scrollAt = scrollTop();
    boxes = setup.peers.map((peer) => boxOf(peer.elements));
    const own = boxes[self];
    const next = boxes[self + 1];
    const previous = boxes[self - 1];
    if (!own) return false;
    // The room the dragged item takes, its gap included.
    span = next
      ? next.top - own.top
      : previous
        ? own.bottom - previous.bottom
        : own.bottom - own.top;
    index = self;
    document.body.classList.add('fl-dragging');
    window.getSelection()?.removeAllRanges();
    for (const element of setup.unit.elements) element.classList.add('drag-lift');
    for (const peer of setup.peers)
      if (peer !== setup.unit)
        for (const element of peer.elements) element.classList.add('drag-peer');
    return true;
  };

  const move = (): void => {
    const own = boxes[self];
    const first = boxes[0];
    const last = boxes.at(-1);
    if (!own || !first || !last) return;
    const scrolled = scrollTop() - scrollAt;
    // Locked to the list's bounds.
    const height = own.bottom - own.top;
    const dy = Math.max(
      first.top - own.top,
      Math.min(last.bottom - height - own.top, lastY - startY + scrolled),
    );
    setShift(setup.unit, dy);
    // Where it would land among the others: its leading edge past their middles (its bottom
    // going down, its top going up), so even the last item can be passed within the bounds.
    const edge = dy > 0 ? own.top + dy + height : dy < 0 ? own.top + dy : own.top + height / 2;
    const others = boxes.filter((_, at) => at !== self);
    const middles = others.map((box) => (box.top + box.bottom) / 2);
    let next = middles.findIndex((value) => edge < value);
    if (next < 0) next = others.length;
    const before = middles[next - 1];
    const after = middles[next];
    offset = before === undefined || after === undefined ? 0.5 : (edge - before) / (after - before);
    if (next !== index) {
      index = next;
      setup.peers.forEach((peer, at) => {
        if (at === self) return;
        const rank = at < self ? at : at - 1;
        const shift = at < self && rank >= index ? span : at > self && rank < index ? -span : 0;
        setShift(peer, shift);
      });
    }
    setup.onOver?.(index, offset);
  };

  const autoScroll = (): void => {
    frame = 0;
    const scroller = setup.scroller;
    if (!active || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const by =
      lastY < rect.top + EDGE
        ? -Math.ceil((rect.top + EDGE - lastY) / 4)
        : lastY > rect.bottom - EDGE
          ? Math.ceil((lastY - rect.bottom + EDGE) / 4)
          : 0;
    if (by === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += by;
    if (scroller.scrollTop !== before) {
      move();
      frame = requestAnimationFrame(autoScroll);
    }
  };

  const onMove = (event: MouseEvent): void => {
    lastY = event.clientY;
    if (!active) {
      if (Math.abs(lastY - startY) < THRESHOLD) return;
      if (!lift()) {
        stop();
        return;
      }
      active = true;
    }
    event.preventDefault();
    move();
    if (!frame) frame = requestAnimationFrame(autoScroll);
  };

  const cleanUp = (): void => {
    document.body.classList.remove('fl-dragging');
    for (const peer of setup.peers)
      for (const element of peer.elements) {
        element.classList.remove('drag-lift', 'drag-peer', 'drag-drop');
        element.style.transform = '';
      }
    setup.onSettle?.();
  };

  const onUp = (): void => {
    stop();
    if (!active) return;
    active = false;
    // The click that ends a drag isn't a click on the item.
    const swallow = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    const own = boxes[self];
    const others = boxes.filter((_, at) => at !== self);
    if (!own || index === self) {
      // Back to where it was.
      for (const element of setup.unit.elements) element.classList.add('drag-drop');
      setShift(setup.unit, 0);
      window.setTimeout(cleanUp, reduceMotion() ? 0 : 160);
      return;
    }
    // Into its slot: where the item it passed ends, less the room it took from it.
    const slot =
      index > self
        ? (others[index - 1]?.bottom ?? own.bottom) - (own.bottom - own.top) - own.top
        : (others[index]?.top ?? own.top) - own.top;
    for (const element of setup.unit.elements) element.classList.add('drag-drop');
    setShift(setup.unit, slot);
    // Once the list re-renders in the new order, the transforms go in the same frame.
    const container = setup.unit.elements[0]?.parentElement;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      cleanUp();
    };
    const observer = new MutationObserver(finish);
    if (container) observer.observe(container, { childList: true });
    void setup.onDrop(index, offset).then((changed) => {
      if (!changed) {
        setup.peers.forEach((peer) => setShift(peer, 0));
        window.setTimeout(finish, reduceMotion() ? 0 : 160);
      } else window.setTimeout(finish, 1500);
    });
  };

  function stop(): void {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
}
