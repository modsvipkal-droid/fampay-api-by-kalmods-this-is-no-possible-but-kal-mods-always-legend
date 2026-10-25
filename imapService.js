import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseBankEmail } from './bankRegex.js';
import dotenv from 'dotenv';

dotenv.config();

function getClient(user, pass) {
  const cleanPass = (pass || process.env.GMAIL_APP_PASS || '').replace(/\s+/g, '');
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: user || process.env.GMAIL_USER,
      pass: cleanPass
    },
    logger: false
  });
}

/**
 * Verify if Gmail credentials work
 */
export async function testGmailConnection(user, pass) {
  const client = getClient(user, pass);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    await client.logout();
    return { success: true, message: 'Gmail IMAP connection successful!' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Scan recent incoming emails for an amount match
 */
export async function scanForPayment({ targetAmount, targetUtr = null, sinceMinutes = 10 }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASS;

  if (!user || !pass || user === 'example@gmail.com') {
    return { error: 'GMAIL_CREDENTIALS_NOT_CONFIGURED' };
  }

  const client = getClient(user, pass);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search for messages received since yesterday
      const sinceDate = new Date(Date.now() - sinceMinutes * 60 * 1000);
      const messages = [];

      // Fetch last 15 messages (most recent first)
      for await (const message of client.fetch({ seq: '1:*' }, { envelope: true, source: true })) {
        messages.push(message);
      }

      // Sort newest first
      messages.reverse();
      const recentMessages = messages.slice(0, 15);

      for (const msg of recentMessages) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || '';
        const body = parsed.text || parsed.html || '';

        const bankData = parseBankEmail(body, subject);
        if (!bankData) continue;

        // If targetUtr is provided, match by UTR
        if (targetUtr && bankData.utr === targetUtr) {
          return { matched: true, data: bankData, rawSubject: subject };
        }

        // Match by amount
        if (Math.abs(bankData.amount - targetAmount) < 0.01) {
          return { matched: true, data: bankData, rawSubject: subject };
        }
      }

      return { matched: false };
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (err) {
    console.error('IMAP scan error:', err.message);
    return { error: err.message };
  }
}
