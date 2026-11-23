import type { DMARCAnalysis } from '@/types/dmarc';

/**
 * Email sending is currently disabled (Resend has been removed and no other
 * transport is configured). The digest template in `src/emails/dmarc-report.tsx`
 * is kept so a transport (e.g. Graph sendMail or SMTP) can be added later.
 */
export async function sendDMARCReportEmail(
  _analysis: DMARCAnalysis,
): Promise<{ success: boolean; error?: string; id?: string }> {
  return { success: false, error: 'Email sending is disabled' };
}
