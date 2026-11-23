import 'server-only';
import { getFetchDays, getGraphConfig } from '@/lib/config';
import { graphFetch } from './client';

export interface MailboxAttachmentRef {
  id: string;
  filename: string;
  /** Download the raw attachment bytes (the expensive step). */
  download: () => Promise<Buffer>;
}

export interface MailboxMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  attachments: MailboxAttachmentRef[];
}

interface GraphList<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface GraphMessage {
  id: string;
  subject: string | null;
  receivedDateTime: string;
  hasAttachments: boolean;
  /** Present because the list query expands attachments. */
  attachments?: GraphAttachment[];
}

interface GraphAttachment {
  id: string;
  name: string;
  size: number;
  '@odata.type': string;
}

const PAGE_SIZE = 50;
// Safety nets so a huge mailbox can't make one fetch run away.
const MAX_PAGES = 40;
const MAX_MESSAGES = 1000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const REPORT_NAME = /\.(xml|xml\.gz|gz|zip)$/i;

/**
 * List messages from the last `DMARC_FETCH_DAYS` days (default 90) that carry
 * report-like attachments (.xml.gz etc.), newest first. Only metadata is
 * fetched here; each attachment is downloaded lazily via `download()`, so
 * callers can skip cached ones.
 *
 * Graph rejects $orderby combined with a hasAttachments $filter
 * (InefficientFilter), so messages are ordered by date, paged with
 * @odata.nextLink, and filtered here. Attachments are expanded inline so a
 * page of 50 messages costs one request instead of 51.
 */
export async function listMailboxReports(): Promise<MailboxMessage[]> {
  const { mailbox, folder } = getGraphConfig();
  const cutoff = Date.now() - getFetchDays() * 24 * 60 * 60 * 1000;
  const user = encodeURIComponent(mailbox);
  const attachmentsBase = (messageId: string) =>
    `/users/${user}/messages/${encodeURIComponent(messageId)}/attachments`;

  const query = new URLSearchParams({
    $orderby: 'receivedDateTime desc',
    $select: 'id,subject,receivedDateTime,hasAttachments',
    $expand: 'attachments($select=id,name,size,contentType)',
    $top: String(PAGE_SIZE),
  });

  const results: MailboxMessage[] = [];
  let scanned = 0;
  let url: string | undefined =
    `/users/${user}/mailFolders/${encodeURIComponent(folder)}/messages?${query}`;

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body = (await (
      await graphFetch(url)
    ).json()) as GraphList<GraphMessage>;

    for (const message of body.value) {
      if (Date.parse(message.receivedDateTime) < cutoff) {
        url = undefined; // newest first: everything after this is older
        break;
      }
      if (++scanned > MAX_MESSAGES) {
        url = undefined;
        break;
      }
      if (!message.hasAttachments) {
        continue;
      }

      // Fall back to a per-message request if the expansion was omitted.
      const list =
        message.attachments ??
        (
          (await (
            await graphFetch(
              `${attachmentsBase(message.id)}?$select=id,name,size`,
            )
          ).json()) as GraphList<GraphAttachment>
        ).value;

      const attachments: MailboxAttachmentRef[] = list
        .filter(
          (att) =>
            att['@odata.type'] === '#microsoft.graph.fileAttachment' &&
            REPORT_NAME.test(att.name) &&
            att.size <= MAX_ATTACHMENT_BYTES,
        )
        .map((att) => ({
          id: att.id,
          filename: att.name,
          // $value returns raw bytes and works for attachments of any size.
          download: async () =>
            Buffer.from(
              await (
                await graphFetch(
                  `${attachmentsBase(message.id)}/${encodeURIComponent(att.id)}/$value`,
                )
              ).arrayBuffer(),
            ),
        }));

      if (attachments.length > 0) {
        results.push({
          id: message.id,
          subject: message.subject ?? '',
          receivedDateTime: message.receivedDateTime,
          attachments,
        });
      }
    }

    if (url) {
      url = body['@odata.nextLink'];
    }
  }

  return results;
}
