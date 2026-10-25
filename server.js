import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { createOrder, getOrder, markOrderPaid, isUtrAlreadyUsed, getAllOrders } from './db.js';
import { scanForPayment, testGmailConnection } from './imapService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to format IST timestamp
function getIstTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replace(',', '');
}

// ==========================================
// 1. Generate QR Code (Supports /api/create-order and /qr.php)
// ==========================================
async function handleGenerateQr(req, res) {
  try {
    const amount = req.body?.amount || req.query?.amount || 0;
    const customUpi = req.body?.upi || req.query?.upi;

    const upiId = customUpi || process.env.UPI_ID || 'demo@fam';
    const merchantName = process.env.MERCHANT_NAME || 'FamPay Merchant';
    const expiryMinutes = parseInt(process.env.ORDER_EXPIRY_MINUTES || '5', 10);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    // Format Order ID: FAMPAY...
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const randHex = Math.random().toString(16).substring(2, 8).toUpperCase();
    const orderId = `FAMPAY${dateStr}${randHex}`;

    const order = await createOrder({
      orderId,
      amount: parseFloat(amount) || 0,
      upiId,
      merchantName,
      expiryMinutes
    });

    // Standard NPCI UPI URI
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${order.amount > 0 ? order.amount.toFixed(2) : ''}&tn=${encodeURIComponent(orderId)}&cu=INR`;

    const qrCodeData = await QRCode.toDataURL(upiUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 320,
      color: {
        dark: '#18181b',
        light: '#ffffff'
      }
    });

    res.json({
      status: 'success',
      data: {
        order_id: orderId,
        qr_url: qrCodeData,
        upi_id: upiId,
        amount: order.amount,
        created_at_ist: getIstTime(now),
        expires_at_ist: getIstTime(expiresAt)
      },
      dev: '@kal_mods'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}

app.all('/qr.php', handleGenerateQr);
app.all('/api/create-order', handleGenerateQr);

// ==========================================
// 2. Verify Payment (Supports /api/check-status and /verify.php)
// ==========================================
async function handleVerify(req, res) {
  try {
    const orderId = req.params?.orderId || req.query?.order_id || req.body?.order_id;

    if (!orderId) {
      return res.status(400).json({ status: 'error', message: 'order_id parameter required' });
    }

    const order = await getOrder(orderId);

    // If order was in-memory or simulated
    if (order && order.status === 'SUCCESS') {
      return res.json({
        status: 'success',
        data: {
          order_id: order.order_id,
          transaction_id: order.bank_info || `FMPIB${Math.floor(1000000000 + Math.random() * 9000000000)}`,
          amount: order.amount,
          utr: order.utr || '301268197755',
          sender_name: order.sender_name || 'Customer',
          payment_time_ist: getIstTime(new Date(order.paid_at || Date.now()))
        },
        dev: '@kal_mods'
      });
    }

    // Scan Gmail via IMAP
    const scanResult = await scanForPayment({
      targetAmount: order ? order.amount : 0,
      sinceMinutes: 10
    });

    if (scanResult.matched && scanResult.data) {
      const { utr, senderName, transactionId } = scanResult.data;

      if (order) {
        await markOrderPaid(orderId, {
          utr: utr || `UTR_${Date.now()}`,
          senderName,
          bankInfo: transactionId
        });
      }

      return res.json({
        status: 'success',
        data: {
          order_id: orderId,
          transaction_id: transactionId || `FMPIB${Date.now().toString().slice(-10)}`,
          amount: scanResult.data.amount,
          utr: utr || '301268197755',
          sender_name: senderName || 'Customer',
          payment_time_ist: getIstTime()
        },
        dev: '@kal_mods'
      });
    }

    // Not detected yet
    return res.json({
      status: 'error',
      message: 'Transaction failed - Payment not received yet',
      order_id: orderId,
      dev: '@kal_mods'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}

app.all('/verify.php', handleVerify);
app.get('/api/check-status/:orderId', handleVerify);

// ==========================================
// 3. Live Demo Simulation Trigger
// ==========================================
app.post('/api/simulate-fampay-payment', async (req, res) => {
  const { orderId, amount, senderName } = req.body;
  const dummyTxnId = `FMPIB${Math.floor(1000000000 + Math.random() * 9000000000)}`;
  const dummyUtr = '301' + Math.floor(100000000 + Math.random() * 900000000);

  const updated = await markOrderPaid(orderId, {
    utr: dummyUtr,
    senderName: senderName || 'Anuj Patel',
    bankInfo: dummyTxnId
  });

  res.json({
    status: 'success',
    message: '⚡ Live FamPay email simulation received and verified!',
    data: {
      order_id: orderId,
      transaction_id: dummyTxnId,
      amount: amount || (updated ? updated.amount : 10),
      utr: dummyUtr,
      sender_name: senderName || 'Anuj Patel',
      payment_time_ist: getIstTime()
    },
    dev: '@kal_mods'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FamPay Auto Payment System running at http://localhost:${PORT}`);
});
