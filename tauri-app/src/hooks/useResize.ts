import { useState, useCallback, useEffect, useRef } from "react";

interface UseResizeOptions {
  direction: "horizontal" | "vertical";
  initialSize: number;
  minSize: number;
  maxSize: number;
  /** If true, the resize handle is on the "start" side (left for horizontal, top for vertical) */
  invertDrag?: boolean;
  storageKey?: string;
}

export function useResize({
  direction,
  initialSize,
  minSize,
  maxSize,
  invertDrag = false,
  storageKey,
}: UseResizeOptions) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minSize && parsed <= maxSize) return parsed;
      }
    }
    return initialSize;
  });

  const [collapsed, setCollapsed] = useState(false);
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSize.current = size;
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, size]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = invertDrag
        ? startPos.current - currentPos
        : currentPos - startPos.current;
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      setSize(newSize);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) {
        localStorage.setItem(storageKey, String(size));
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [direction, invertDrag, maxSize, minSize, size, storageKey]);

  // Save on size change (debounced via mouseup)
  useEffect(() => {
    if (storageKey && !isDragging.current) {
      localStorage.setItem(storageKey, String(size));
    }
  }, [size, storageKey]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const expand = useCallback(() => {
    setCollapsed(false);
  }, []);

  return {
    size: collapsed ? 0 : size,
    rawSize: size,
    collapsed,
    toggleCollapse,
    expand,
    handleMouseDown,
    isDragging: isDragging.current,
  };
}
