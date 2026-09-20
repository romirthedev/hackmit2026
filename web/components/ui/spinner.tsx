import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

function Spinner({
  className,
  'aria-label': label = 'Loading',
  ...props
}: React.ComponentProps<'svg'>) {
  return (
    <output
      className="inline-flex align-middle"
      aria-label={label}
      aria-hidden={props['aria-hidden']}
    >
      <Loader2Icon
        data-slot="spinner"
        aria-hidden="true"
        className={cn('size-4 animate-spin', className)}
        {...props}
      />
    </output>
  );
}

export { Spinner };
