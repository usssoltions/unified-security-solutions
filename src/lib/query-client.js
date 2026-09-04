import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			// Default freshness window: navigations within 15s reuse cached
			// data instantly instead of refetching on every page change
			// (queries with their own staleTime keep theirs). Explicit
			// invalidation still forces an immediate refetch.
			staleTime: 15000,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});