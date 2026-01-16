import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Configure QueryClient with better error handling
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 30000,
      cacheTime: 300000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      onError: (error) => {
        // Suppress non-critical errors from UI
        const errorMsg = error?.message || '';
        if (
          errorMsg.includes('WebSocket') ||
          errorMsg.includes('socket') ||
          errorMsg.includes('network') ||
          errorMsg.includes('fetch')
        ) {
          // Silent fail for connection issues
          return;
        }
        console.error('Query error:', error);
      }
    },
    mutations: {
      retry: 2,
      retryDelay: 1000,
      onError: (error) => {
        // Only log critical mutation errors
        const errorMsg = error?.message || '';
        if (!errorMsg.includes('WebSocket') && !errorMsg.includes('socket')) {
          console.error('Mutation error:', error);
        }
      }
    }
  }
});

export function GlobalErrorBoundary({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}