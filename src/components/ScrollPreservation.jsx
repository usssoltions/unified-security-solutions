import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const scrollPositions = new Map();

export default function ScrollPreservation({ children }) {
  const location = useLocation();
  const scrollRef = useRef(null);

  useEffect(() => {
    // Restore scroll position
    const savedPosition = scrollPositions.get(location.pathname);
    if (savedPosition && scrollRef.current) {
      scrollRef.current.scrollTop = savedPosition;
    }

    // Save scroll position on unmount
    return () => {
      if (scrollRef.current) {
        scrollPositions.set(location.pathname, scrollRef.current.scrollTop);
      }
    };
  }, [location.pathname]);

  return (
    <div ref={scrollRef} className="overflow-auto h-full">
      {children}
    </div>
  );
}