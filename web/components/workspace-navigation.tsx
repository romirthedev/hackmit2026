'use client';

import type { ComponentProps } from 'react';
import { TabsList } from '@/components/ui/tabs';
import { useSidebar } from '@/components/ui/sidebar';

// Keep the sourced mobile sheet out of the way after choosing a workspace view.
export function WorkspaceTabsList(props: ComponentProps<typeof TabsList>) {
  const { setOpenMobile } = useSidebar();
  return (
    <TabsList
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if ((event.target as HTMLElement).closest('[role="tab"]'))
          setOpenMobile(false);
      }}
    />
  );
}
