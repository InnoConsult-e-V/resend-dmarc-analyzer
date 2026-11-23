import 'server-only';
import { getGraphConfig } from '@/lib/config';
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
}

interface GraphAttachment {
  id: string;
  name: string;
  size: number;
  '@odata.type': string;
}

const MAX_MESSAGES = 50;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const REPORT_NAME = /\.(xml|xml\.gz|gz|zip)$/i;

/**
 * List the most recent messages with report-like attachments (.xml.gz etc.) in the
 * configured mailbox folder. Only metadata is fetched here; each attachment
 * is downloaded lazily via `download()`, so callers can skip cached ones.
 */
export async function listMailboxReports(): Promise<MailboxMessage[]> {
  const { mailbox, folder } = getGraphConfig();
  const user = encodeURIComponent(mailbox);
  const filter = encodeURIComponent('hasAttachments eq true');
  const select = 'id,subject,receivedDateTime';

  const messagesRes = await graphFetch(
    `/users/${user}/mailFolders/${encodeURIComponent(folder)}/messages?$filter=${filter}&$select=${select}&$top=${MAX_MESSAGES}`,
  );
  const messages = ((await messagesRes.json()) as GraphList<GraphMessage>)
    .value;

  const results: MailboxMessage[] = [];
  for (const message of messages) {
    const base = `/users/${user}/messages/${encodeURIComponent(message.id)}/attachments`;
    const listRes = await graphFetch(`${base}?$select=id,name,size`);
    const list = ((await listRes.json()) as GraphList<GraphAttachment>).value;

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
              await graphFetch(`${base}/${encodeURIComponent(att.id)}/$value`)
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

  return results;
}
