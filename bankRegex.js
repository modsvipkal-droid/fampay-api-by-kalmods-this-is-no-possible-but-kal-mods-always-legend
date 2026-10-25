/**
 * bankRegex.js
 * Enhanced Pattern Matcher specifically optimized for FamPay (FamApp) & Indian Bank UPI Emails
 */

export function parseBankEmail(text, subject = '') {
  if (!text) return null;
  const combined = `${subject}\n${text}`;

  // 1. Check if credit email
  const isCredit = /(?:credited|received|deposited|added to your|money received)/i.test(combined);
  if (!isCredit) return null;

  // 2. Extract Amount
  const amountPatterns = [
    /(?:received|credited\s*(?:with|by)?|deposited|amount of)\s*(?:Rs\.?|INR|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    /(?:Rs\.?|INR|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:has been received|received|credited)/i,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:credited|received)/i
  ];

  let amount = null;
  for (const pattern of amountPatterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      amount = parseFloat(match[1]);
      break;
    }
  }

  if (!amount || isNaN(amount)) return null;

  // 3. Extract FamPay Transaction ID (Format: FMPIB... or FAMPAY...)
  let transactionId = null;
  const txnMatch = combined.match(/(?:Transaction\s*ID|Txn\s*ID|Txn\s*Ref)[:\s]+(FMPIB[A-Za-z0-9]+|FAM[A-Za-z0-9]+)/i);
  if (txnMatch && txnMatch[1]) {
    transactionId = txnMatch[1];
  }

  // 4. Extract 12-Digit UPI Reference Number (UTR)
  const utrPatterns = [
    /(?:UPI\s*Ref(?:\s*No\.?)?|UTR(?:\s*No\.?)?|Ref\s*No\.?|Reference\s*No\.?)[\s:\/-]+([0-9]{12})/i,
    /(?:UPI|Txn)[:\s\/]+([0-9]{12})/i,
    /(?:\b|\D)([0-9]{12})(?:\b|\D)/
  ];

  let utr = null;
  for (const pattern of utrPatterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      utr = match[1];
      break;
    }
  }

  // 5. Extract Sender Name
  const senderPatterns = [
    /(?:from|sender|remitter)[\s:]+([A-Za-z\s]{3,35})(?:\.|\n|\r|<|,|via|Transaction|UPI)/i,
    /(?:received\s+from)[\s:]+([A-Za-z\s]{3,35})/i
  ];

  let senderName = null;
  for (const pattern of senderPatterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      const clean = match[1].replace(/\s+/g, ' ').trim();
      if (!/^(UPI|FamPay|FamApp|Account|Customer)$/i.test(clean)) {
        senderName = clean;
        break;
      }
    }
  }

  // 6. Detect Provider
  let isFamPay = /FamPay|FamApp|FMPIB/i.test(combined);

  return {
    amount,
    utr: utr || null,
    transactionId: transactionId || (isFamPay ? `FMPIB${Date.now().toString().slice(-10)}` : null),
    senderName: senderName || 'Customer',
    provider: isFamPay ? 'FamPay' : 'Bank UPI'
  };
}
