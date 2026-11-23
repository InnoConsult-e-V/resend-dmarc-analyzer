import { NextResponse } from 'next/server';
import { cacheKey, getCached, setCached } from '@/lib/cache/report-cache';
import { processAttachments } from '@/lib/dmarc/attachments';
import { parseAndAnalyze } from '@/lib/dmarc/parser';
import { GraphError, NotSignedInError } from '@/lib/graph/client';
import { listMailboxReports } from '@/lib/graph/fetch-reports';
import type { DMARCAnalysis } from '@/types/dmarc';

export const dynamic = 'force-dynamic';

// Only one mailbox fetch at a time.
let inFlight = false;

export async function POST(request: Request) {
  if (inFlight) {
    return NextResponse.json(
      { error: 'A fetch is already in progress' },
      { status: 429 },
    );
  }
  inFlight = true;

  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const messages = await listMailboxReports();

    const reports: Array<{
      analysis: DMARCAnalysis;
      subject: string;
      receivedDateTime: string;
    }> = [];
    const errors: string[] = [];
    let cached = 0;
    let fetched = 0;

    for (const message of messages) {
      for (const attachment of message.attachments) {
        const key = cacheKey(message.id, attachment.id);
        try {
          const hit = refresh ? null : await getCached(key);
          if (hit) {
            reports.push({
              analysis: hit.analysis,
              subject: message.subject,
              receivedDateTime: message.receivedDateTime,
            });
            cached++;
            continue;
          }

          const content = await attachment.download();
          const xmlDocs = await processAttachments([
            { filename: attachment.filename, content },
          ]);
          for (const xml of xmlDocs) {
            const analysis = parseAndAnalyze(xml);
            reports.push({
              analysis,
              subject: message.subject,
              receivedDateTime: message.receivedDateTime,
            });
            await setCached(key, {
              subject: message.subject,
              receivedDateTime: message.receivedDateTime,
              analysis,
            });
            fetched++;
          }
        } catch (err) {
          // Parse errors are about report content, not secrets.
          errors.push(
            `"${message.subject}": ${err instanceof Error ? err.message : 'failed to parse'}`,
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      messages: messages.length,
      cached,
      fetched,
      reports,
      errors,
    });
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return NextResponse.json(
        { error: 'Sign in required', signInRequired: true },
        { status: 401 },
      );
    }
    const message =
      err instanceof GraphError
        ? err.message
        : err instanceof Error &&
            err.message.startsWith('Missing configuration')
          ? err.message
          : 'Failed to fetch reports from mailbox';
    console.error('[reports/fetch]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    inFlight = false;
  }
}
