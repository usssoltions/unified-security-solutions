import React, { useEffect, useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

export default function PullToRefresh({ onRefresh, children }) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);

  const threshold = 80;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let touchStartY = 0;

    const handleTouchStart = (e) => {
      if (container.scrollTop === 0) {
        touchStartY = e.touches[0].clientY;
        startY.current = touchStartY;
      }
    };

    const handleTouchMove = (e) => {
      if (container.scrollTop === 0 && !refreshing) {
        const currentY = e.touches[0].clientY;
        const distance = currentY - startY.current;
        
        if (distance > 0) {
          setPulling(true);
          setPullDistance(Math.min(distance, threshold * 1.5));
        }
      }
    };

    const handleTouchEnd = async () => {
      if (pullDistance >= threshold && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } catch (error) {
          console.error('Refresh error:', error);
        } finally {
          setTimeout(() => {
            setRefreshing(false);
            setPulling(false);
            setPullDistance(0);
          }, 500);
        }
      } else {
        setPulling(false);
        setPullDistance(0);
      }
    };

    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchmove', handleTouchMove);
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div ref={containerRef} className="relative overflow-auto h-full">
      {/* Pull indicator */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-center transition-all duration-200 overflow-hidden"
        style={{
          height: `${pullDistance}px`,
          opacity: pulling ? 1 : 0,
        }}
      >
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-full p-3 shadow-lg">
          <RefreshCw
            className={`w-6 h-6 text-sky-400 ${
              refreshing ? 'animate-spin' : ''
            }`}
            style={{
              transform: `rotate(${(pullDistance / threshold) * 360}deg)`,
            }}
          />
        </div>
      </div>

      {/* Content with offset when pulling */}
      <div
        style={{
          transform: `translateY(${pulling ? pullDistance : 0}px)`,
          transition: pulling ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}