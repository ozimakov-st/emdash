// Fork (ozimakov-st): a ticket's pixel icon: its `icon.svg` (already checked by the main
// process, shown as an <img>, so it can never run code), else the procedural sprite.
import { useMemo } from 'react';
import { fallbackSprite, iconDataUrl, SPRITE_SIZE } from '@core/features/ozdash/api/ticket-icon';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { cn } from '@core/primitives/styling/browser/cn';

const PIXELATED = { imageRendering: 'pixelated' } as const;

export function TicketIcon({
  ticket,
  size,
  className,
}: {
  ticket: Pick<TicketSummary, 'id' | 'priority' | 'icon'>;
  /** Pixels: 24 on cards, 16 in rows. */
  size: number;
  className?: string;
}) {
  const src = useMemo(() => (ticket.icon ? iconDataUrl(ticket.icon) : null), [ticket.icon]);
  const pixels = useMemo(
    () => (src ? [] : fallbackSprite(ticket.id, ticket.priority)),
    [src, ticket.id, ticket.priority]
  );
  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden
        draggable={false}
        style={PIXELATED}
        className={cn('shrink-0', className)}
      />
    );
  }
  return (
    <svg
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden
      style={PIXELATED}
      className={cn('shrink-0', className)}
    >
      {pixels.map((pixel) => (
        <rect
          key={`${pixel.x}-${pixel.y}`}
          x={pixel.x}
          y={pixel.y}
          width={1}
          height={1}
          fill={pixel.fill}
        />
      ))}
    </svg>
  );
}
