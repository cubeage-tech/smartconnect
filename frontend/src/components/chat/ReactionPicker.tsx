import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placePopover, type PopoverBox } from '../../lib/reactions';
import { EmojiPicker } from '../ui/EmojiPicker';
import { Layer } from '../ui/Layer';

interface ReactionPickerProps {
  /** The React button that opened it. */
  anchor: HTMLElement;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const PREFERRED = { width: 350, height: 420 };

/**
 * QA H2 / M1 / L13: the reaction picker, rendered at the end of <body> next to
 * the React button. It used to be absolutely positioned inside the message row,
 * so the scrolling message list clipped it (only its search bar showed for
 * recent messages); and the list stopped click propagation, so neither Escape
 * nor a click on another message closed it. Now: placed fully on screen
 * (flips above when there is no room below), closes on Escape, on a pointer
 * down outside it, and when the page scrolls or resizes under it.
 */
export const ReactionPicker = ({ anchor, onPick, onClose }: ReactionPickerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [box, setBox] = useState<PopoverBox | null>(null);

  useLayoutEffect(() => {
    setBox(placePopover(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, PREFERRED));
  }, [anchor]);

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && (ref.current?.contains(target) || anchor.contains(target));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        anchor.focus?.();
      }
    };
    // Scrolling the message list moves the anchor: close rather than float
    // away from it. The picker's own scrolling (its emoji grid) is ignored.
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onCloseRef.current();
    };
    const onResize = () => onCloseRef.current();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  return (
    <Layer>
      <div
        ref={ref}
        role="dialog"
        aria-label="Choose a reaction"
        style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : { visibility: 'hidden' }}
        className="fixed z-[165] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl animate-scale-in"
      >
        {box && <EmojiPicker onPick={onPick} width={box.width} height={box.height} />}
      </div>
    </Layer>
  );
};
