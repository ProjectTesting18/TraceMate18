/**
 * src/services/whatsappService.js
 * WhatsApp notifications via Twilio WhatsApp API
 */

const logger = require('../utils/logger');

let twilioClient = null;

const getClient = () => {
  if (twilioClient) return twilioClient;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return twilioClient;
};

const FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// ── Send a WhatsApp message
const sendWhatsApp = async (toPhone, message) => {
  const client = getClient();
  if (!client) {
    logger.warn('Twilio not configured — skipping WhatsApp send.');
    return false;
  }
  if (!toPhone) return false;

  // Normalize phone number
  const normalizedPhone = toPhone.startsWith('+') ? toPhone : `+91${toPhone.replace(/\D/g, '')}`;
  const to = `whatsapp:${normalizedPhone}`;

  try {
    const msg = await client.messages.create({ from: FROM, to, body: message });
    logger.info(`WhatsApp sent: ${msg.sid} → ${to}`);
    return true;
  } catch (err) {
    logger.error(`WhatsApp send failed: ${err.message}`);
    return false;
  }
};

// ════════════════════════════════════════
//  MESSAGE TEMPLATES
// ════════════════════════════════════════
const whatsappService = {
  sendMatchAlert: async (user, lostItem, foundItem, score, confidence) => {
    if (!user.notificationPrefs?.whatsapp || !user.phone) return false;
    const msg =
`📍 *TraceMate – Match Alert!*

Hello ${user.fullName.split(' ')[0]} 👋

🤖 Our AI found a *${confidence.toUpperCase()} confidence match* (${score}%) for your lost item!

🔴 *Your Lost Item:* ${lostItem.itemName}
📍 Lost at: ${lostItem.lastSeenLocation}

🟢 *Found Item:* ${foundItem.itemName}
📍 Found at: ${foundItem.foundLocation}
📦 Stored at: ${foundItem.storageLocation || 'Security Office'}

Login to TraceMate to review and submit a claim:
${process.env.FRONTEND_URL || 'http://localhost:3000'}

_R.H. Sapat College · TraceMate_`;
    return sendWhatsApp(user.phone, msg);
  },

  sendClaimApproved: async (user, lostItem, foundItem) => {
    if (!user.phone) return false;
    const msg =
`✅ *TraceMate – Claim Approved!*

Hello ${user.fullName.split(' ')[0]},

Great news! Your claim for *${lostItem.itemName}* has been *APPROVED* by the admin.

📦 *Collect from:* ${foundItem.storageLocation || 'Security Office'}
🪪 Please carry your Student ID when collecting.

Login to view full details:
${process.env.FRONTEND_URL || 'http://localhost:3000'}

_R.H. Sapat College · TraceMate_`;
    return sendWhatsApp(user.phone, msg);
  },

  sendClaimRejected: async (user, lostItem, reason) => {
    if (!user.phone) return false;
    const msg =
`📋 *TraceMate – Claim Update*

Hello ${user.fullName.split(' ')[0]},

Your claim for *${lostItem.itemName}* could not be approved at this time.

${reason ? `📝 Reason: ${reason}` : ''}

You may login and submit a new claim with additional proof:
${process.env.FRONTEND_URL || 'http://localhost:3000'}

_R.H. Sapat College · TraceMate_`;
    return sendWhatsApp(user.phone, msg);
  },
};

module.exports = whatsappService;
