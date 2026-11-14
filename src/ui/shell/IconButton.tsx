import type { ComponentProps, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { cn } from '@/lib/cn';

interface IconButtonProps extends ComponentProps<'button'> {
  /** Read by screen readers and shown as the tooltip. */
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  active?: boolean;
  children: ReactNode;
}

/** A square icon button with a tooltip. 40 px, 44 px on touch screens. */
export function IconButton({ label, side = 'left', active, className, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground/85 transition-colors duration-150 hover:bg-secondary hover:text-foreground active:bg-accent disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-[18px]',
            active && 'bg-secondary text-primary',
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
