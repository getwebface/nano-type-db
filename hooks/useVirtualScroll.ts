import { useState, useEffect, useCallback, useRef } from 'react';

const LOADING_RESET_DELAY_MS = 500;

export interface VirtualScrollOptions {
  rowHeight?: number;
  overscan?: number;
  loadMoreThreshold?: number;
}

export const useVirtualScroll = (
  totalRows: number,
  loadMore?: () => void,
  hasMore?: boolean,
  options: VirtualScrollOptions = {}
) => {
  const {
    rowHeight = 40,
    overscan = 5,
    loadMoreThreshold = 0.8
  } = options;

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);

  const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleEnd = Math.min(
    totalRows,
    Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan
  );

  const visibleRows = Array.from(
    { length: visibleEnd - visibleStart },
    (_, i) => visibleStart + i
  );

  const totalHeight = totalRows * rowHeight;
  const offsetY = visibleStart * rowHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);

    // Infinite scroll loading
    if (hasMore && loadMore && !isLoadingRef.current) {
      const scrollPercentage = (target.scrollTop + target.clientHeight) / target.scrollHeight;
      
      if (scrollPercentage >= loadMoreThreshold) {
        isLoadingRef.current = true;
        loadMore();
        
        // Reset loading flag after a delay
        setTimeout(() => {
          isLoadingRef.current = false;
        }, LOADING_RESET_DELAY_MS);
      }
    }
  }, [hasMore, loadMore, loadMoreThreshold]);

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerHeight(entry.contentRect.height);
        }
      });

      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, []);

  return {
    containerRef,
    visibleRows,
    visibleStart,
    visibleEnd,
    totalHeight,
    offsetY,
    handleScroll,
    rowHeight
  };
};
