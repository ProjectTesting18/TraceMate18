/**
 * src/services/emailService.js
 * Professional HTML email notifications via Nodemailer
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// ── Transporter
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

// ════════════════════════════════════════
//  HTML EMAIL TEMPLATE
// ════════════════════════════════════════
const baseTemplate = (content, preheader = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TraceMate Notification</title>
  <style>
    body { margin:0; padding:0; background:#080c18; font-family:'Segoe UI',Arial,sans-serif; }
    .wrapper { max-width:600px; margin:0 auto; padding:32px 16px; }
    .card { background:#0d1226; border-radius:20px; overflow:hidden;
            border:1px solid rgba(255,255,255,0.08); }
    .header { background:linear-gradient(135deg,#0d1226,#121830);
              padding:32px 40px 24px; border-bottom:1px solid rgba(212,168,67,0.2);
              position:relative; }
    .header::before { content:''; display:block; height:3px;
                      background:linear-gradient(90deg,#d4a843,#f0c96a,#d4a843);
                      border-radius:3px; margin-bottom:28px; }
    .logo { display:flex; align-items:center; gap:12px; }
    .logo-icon { width:44px; height:44px; background:linear-gradient(135deg,#d4a843,#f0c96a);
                 border-radius:12px; display:flex; align-items:center; justify-content:center;
                 font-size:22px; text-align:center; line-height:44px; }
    .logo-text { font-size:22px; font-weight:800; color:#f0c96a; letter-spacing:-0.5px; }
    .logo-sub { font-size:11px; color:rgba(240,201,106,0.6); margin-top:1px; }
    .body { padding:32px 40px; }
    .greeting { font-size:20px; font-weight:700; color:#f0f4ff; margin-bottom:8px; }
    .body-text { font-size:15px; color:rgba(240,244,255,0.7); line-height:1.8; margin-bottom:24px; }
    .item-box { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
                border-radius:14px; padding:20px 24px; margin-bottom:24px;
                border-left:4px solid #d4a843; }
    .item-name { font-size:17px; font-weight:800; color:#f0f4ff; margin-bottom:12px; }
    .item-detail { display:flex; align-items:center; gap:8px; margin-bottom:6px;
                   font-size:13px; color:rgba(240,244,255,0.6); }
    .score-badge { display:inline-block; background:rgba(212,168,67,0.15);
                   color:#f0c96a; border:1px solid rgba(212,168,67,0.3);
                   padding:6px 14px; border-radius:20px; font-size:13px;
                   font-weight:700; margin-bottom:20px; }
    .reasons { background:rgba(34,211,238,0.05); border:1px solid rgba(34,211,238,0.15);
               border-radius:10px; padding:14px 18px; margin-bottom:20px; }
    .reason-title { font-size:12px; font-weight:700; color:#22d3ee;
                    text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px; }
    .reason-item { font-size:13px; color:rgba(240,244,255,0.65); margin-bottom:4px;
                   padding-left:14px; position:relative; }
    .reason-item::before { content:'✓'; position:absolute; left:0; color:#22d3ee; }
    .cta-btn { display:block; background:linear-gradient(135deg,#d4a843,#f0c96a);
               color:#080c18; text-decoration:none; text-align:center;
               padding:15px 32px; border-radius:12px; font-size:15px;
               font-weight:800; margin-bottom:24px; letter-spacing:0.3px; }
    .footer { background:#080c18; padding:24px 40px; text-align:center; }
    .footer-text { font-size:12px; color:rgba(240,244,255,0.3); line-height:1.7; }
    .footer-brand { font-size:13px; color:rgba(212,168,67,0.6); font-weight:600;
                    margin-bottom:4px; }
    .divider { height:1px; background:rgba(255,255,255,0.06); margin:20px 0; }
    .status-approved { color:#34d399; font-weight:700; }
    .status-rejected { color:#fb7185; font-weight:700; }
    .status-pending  { color:#fbbf24; font-weight:700; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">
          <div class="logo-icon">📍</div>
          <div>
            <div class="logo-text">TraceMate</div>
            <div class="logo-sub">Smart Campus Lost & Found</div>
          </div>
        </div>
      </div>
      <div class="body">${content}</div>
      <div class="footer">
        <div class="footer-brand">TraceMate — R.H. Sapat College of Engineering, Nashik</div>
        <div class="footer-text">
          You received this email because you have an active TraceMate account.<br>
          FYMCA Project 2025-26 · Guide: Mrs. Shraddha Wagh
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

// ════════════════════════════════════════
//  TEMPLATE BUILDERS
// ════════════════════════════════════════

const templates = {
  matchFound: (user, lostItem, foundItem, score, reasons = []) => ({
    subject: `🤖 Match Found for Your Lost ${lostItem.itemName} — TraceMate`,
    html: baseTemplate(`
      <div class="greeting">Hi ${user.fullName.split(' ')[0]}, a match was found! 🎉</div>
      <p class="body-text">
        TraceMate's AI engine found a <strong style="color:#f0c96a;">possible match</strong>
        for your lost item. Here are the details:
      </p>
      <div class="score-badge">🤖 Match Confidence: ${score}% — ${score >= 75 ? 'High' : score >= 45 ? 'Medium' : 'Low'}</div>
      <div class="item-box">
        <div class="item-name">📋 Your Lost Item: ${lostItem.itemName}</div>
        <div class="item-detail">📁 Category: ${lostItem.category}</div>
        <div class="item-detail">📍 Lost at: ${lostItem.lastSeenLocation}</div>
        <div class="item-detail">📅 Date lost: ${new Date(lostItem.dateLost).toDateString()}</div>
      </div>
      <div class="item-box" style="border-left-color:#22d3ee;">
        <div class="item-name">📦 Found Item: ${foundItem.itemName}</div>
        <div class="item-detail">📍 Found at: ${foundItem.foundLocation}</div>
        <div class="item-detail">📅 Found on: ${new Date(foundItem.dateFound).toDateString()}</div>
        <div class="item-detail">📦 Stored at: ${foundItem.storageLocation || 'Security Office'}</div>
      </div>
      ${reasons.length ? `
      <div class="reasons">
        <div class="reason-title">Why We Think It Matches</div>
        ${reasons.map(r => `<div class="reason-item">${r}</div>`).join('')}
      </div>` : ''}
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="cta-btn">
        View Match & Submit Claim →
      </a>
      <p class="body-text" style="font-size:13px;">
        Log in to TraceMate to verify the match and submit a claim. 
        An admin will then review and approve your request.
      </p>
    `),
  }),

  claimApproved: (user, lostItem, foundItem, adminNotes) => ({
    subject: `✅ Claim Approved — Collect Your ${lostItem.itemName} — TraceMate`,
    html: baseTemplate(`
      <div class="greeting">Great news, ${user.fullName.split(' ')[0]}! 🎉</div>
      <p class="body-text">
        Your claim has been <span class="status-approved">APPROVED</span> by the admin.
        Your item is ready for collection!
      </p>
      <div class="item-box">
        <div class="item-name">✅ ${lostItem.itemName}</div>
        <div class="item-detail">📁 Category: ${lostItem.category}</div>
        <div class="item-detail">📦 Collect from: <strong style="color:#22d3ee;">${foundItem.storageLocation || 'Security Office'}</strong></div>
        <div class="item-detail">📅 Approved on: ${new Date().toDateString()}</div>
      </div>
      ${adminNotes ? `<div class="reasons"><div class="reason-title">Admin Notes</div><p style="font-size:13px;color:rgba(240,244,255,0.6);margin:0;">${adminNotes}</p></div>` : ''}
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="cta-btn">View Claim Details →</a>
      <p class="body-text" style="font-size:13px;">
        Please carry your Student ID when collecting your item. 
        Contact the admin office if you have any questions.
      </p>
    `),
  }),

  claimRejected: (user, lostItem, adminNotes) => ({
    subject: `📋 Claim Update for ${lostItem.itemName} — TraceMate`,
    html: baseTemplate(`
      <div class="greeting">Hello ${user.fullName.split(' ')[0]},</div>
      <p class="body-text">
        After review, your claim has been <span class="status-rejected">REJECTED</span>.
        Don't worry — you can submit a new claim with additional proof.
      </p>
      <div class="item-box">
        <div class="item-name">📋 ${lostItem.itemName}</div>
        <div class="item-detail">📁 Category: ${lostItem.category}</div>
        <div class="item-detail">📅 Reviewed on: ${new Date().toDateString()}</div>
      </div>
      ${adminNotes ? `<div class="reasons"><div class="reason-title">Reason for Rejection</div><p style="font-size:13px;color:rgba(240,244,255,0.6);margin:0;">${adminNotes}</p></div>` : ''}
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="cta-btn">Browse & Resubmit →</a>
    `),
  }),

  itemCreated: (user, item, type) => ({
    subject: `📍 ${type === 'lost' ? 'Lost' : 'Found'} Item Reported — TraceMate`,
    html: baseTemplate(`
      <div class="greeting">Hi ${user.fullName.split(' ')[0]},</div>
      <p class="body-text">
        Your ${type === 'lost' ? 'lost item report' : 'found item report'} has been submitted successfully.
        Our AI engine will automatically search for matches.
      </p>
      <div class="item-box">
        <div class="item-name">${type === 'lost' ? '📋' : '📦'} ${item.itemName}</div>
        <div class="item-detail">📁 Category: ${item.category}</div>
        <div class="item-detail">📍 Location: ${item.lastSeenLocation || item.foundLocation}</div>
        <div class="item-detail">📅 Date: ${new Date(item.dateLost || item.dateFound).toDateString()}</div>
      </div>
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="cta-btn">View Your Report →</a>
    `),
  }),
};

// ════════════════════════════════════════
//  SEND FUNCTION
// ════════════════════════════════════════
const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('Email not configured — skipping email send.');
    return false;
  }
  try {
    const info = await getTransporter().sendMail({
      from: `"${process.env.FROM_NAME || 'TraceMate'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    logger.info(`Email sent: ${info.messageId} → ${to}`);
    return true;
  } catch (err) {
    logger.error(`Email send failed: ${err.message}`);
    return false;
  }
};

// ── Public methods
const emailService = {
  sendMatchFoundEmail: async (user, lostItem, foundItem, score, reasons) => {
    if (!user.notificationPrefs?.email) return;
    const { subject, html } = templates.matchFound(user, lostItem, foundItem, score, reasons);
    return sendEmail({ to: user.email, subject, html });
  },
  sendClaimApprovedEmail: async (user, lostItem, foundItem, adminNotes) => {
    const { subject, html } = templates.claimApproved(user, lostItem, foundItem, adminNotes);
    return sendEmail({ to: user.email, subject, html });
  },
  sendClaimRejectedEmail: async (user, lostItem, adminNotes) => {
    const { subject, html } = templates.claimRejected(user, lostItem, adminNotes);
    return sendEmail({ to: user.email, subject, html });
  },
  sendItemCreatedEmail: async (user, item, type) => {
    const { subject, html } = templates.itemCreated(user, item, type);
    return sendEmail({ to: user.email, subject, html });
  },
};

module.exports = emailService;
