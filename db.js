import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '..', 'data', 'orders.json');

// Ensure data folder and file exist
async function initDb() {
  const dir = path.dirname(DB_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

await initDb();

export async function getAllOrders() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading DB:', err);
    return [];
  }
}

export async function saveOrders(orders) {
  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(orders, null, 2), 'utf-8');
  await fs.rename(tempFile, DB_FILE);
}

export async function createOrder({ orderId: customOrderId, amount, upiId, merchantName, expiryMinutes = 5 }) {
  const orders = await getAllOrders();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

  const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const orderId = customOrderId || `ORD_${timestamp}_${randomSuffix}`;

  const newOrder = {
    order_id: orderId,
    amount: Number(parseFloat(amount).toFixed(2)),
    upi_id: upiId,
    merchant_name: merchantName,
    status: 'PENDING',
    utr: null,
    sender_name: null,
    bank_info: null,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    paid_at: null
  };

  orders.unshift(newOrder);
  // Keep last 500 orders
  if (orders.length > 500) orders.length = 500;
  await saveOrders(orders);
  return newOrder;
}

export async function getOrder(orderId) {
  const orders = await getAllOrders();
  return orders.find(o => o.order_id === orderId) || null;
}

export async function markOrderPaid(orderId, { utr, senderName, bankInfo }) {
  const orders = await getAllOrders();
  const order = orders.find(o => o.order_id === orderId);
  if (!order) return null;

  order.status = 'SUCCESS';
  order.utr = utr;
  order.sender_name = senderName || 'Customer';
  order.bank_info = bankInfo || null;
  order.paid_at = new Date().toISOString();

  await saveOrders(orders);
  return order;
}

export async function isUtrAlreadyUsed(utr) {
  if (!utr) return false;
  const orders = await getAllOrders();
  return orders.some(o => o.status === 'SUCCESS' && o.utr === utr);
}
