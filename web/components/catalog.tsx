'use client';
// Authenticated originals are served directly by the local API.
/* oxlint-disable next/no-img-element */

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import Aurora from '@/components/react-bits/Aurora';
import StarBorder from '@/components/react-bits/StarBorder';
import { cn } from '@/lib/utils';

// shadcn Button (listed on 21st.dev), with React Bits Star Border for primary actions.
export function CatalogButton({
  className = '',
  variant,
  size,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const classes = typeof className === 'string' ? className : '';
  const resolved =
    variant ??
    (/danger/.test(classes)
      ? 'destructive'
      : /text-button|suggestion|device-shortcut|recording-card|filmstrip-frame/.test(
            classes,
          )
        ? 'ghost'
        : /quiet|chip|command-trigger|recording-button/.test(classes)
          ? 'outline'
          : 'default');
  const buttonSize =
    size ?? (/icon-button|composer-send/.test(classes) ? 'icon-lg' : 'lg');
  if (resolved === 'default') {
    return (
      <StarBorder
        as={Button}
        variant="default"
        size={buttonSize}
        color="#c5f68a"
        speed="7s"
        backgroundColor="#c5f68a"
        textColor="#152010"
        borderColor="#d3faa5"
        className={cn('catalog-primary', classes)}
        {...props}
      >
        {children}
      </StarBorder>
    );
  }
  return (
    <Button
      variant={resolved}
      size={buttonSize}
      className={className}
      {...props}
    >
      {children}
    </Button>
  );
}

const AURORA_COLORS = ['#6fc5b0', '#c5f68a', '#5779ac'];
export function MemoryAurora({ className }: { className?: string }) {
  return (
    <div className={cn('memory-aurora', className)} aria-hidden="true">
      <Aurora
        colorStops={AURORA_COLORS}
        amplitude={0.85}
        blend={0.6}
        speed={0.35}
      />
    </div>
  );
}

// Images are genuine recordings; AspectRatio is the sourced shadcn media container.
export function FrameImage({
  ratio = 16 / 10,
  className,
  alt = '',
  ...props
}: ComponentProps<'img'> & { ratio?: number }) {
  return (
    <AspectRatio ratio={ratio} className={cn('frame-image', className)}>
      <img alt={alt} {...props} />
    </AspectRatio>
  );
}
