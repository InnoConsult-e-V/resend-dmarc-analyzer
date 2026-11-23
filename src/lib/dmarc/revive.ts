import type { DMARCAnalysis } from '@/types/dmarc';

/**
 * JSON turns Dates into strings. Restore `dateRange.start/end` to Dates so an
 * analysis that went through JSON (API response, cache file) can be rendered.
 */
export function reviveAnalysis(analysis: DMARCAnalysis): DMARCAnalysis {
  return {
    ...analysis,
    dateRange: {
      start: new Date(analysis.dateRange.start),
      end: new Date(analysis.dateRange.end),
    },
  };
}
