/**
 * src/services/notificationService.js
 * Orchestrates in-app, email, and WhatsApp notifications
 */

const Notification = require('../models/Notification');
const emailService = require('./emailService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

const notificationService = {
  /**
   * Create an in-app notification + send email/WhatsApp if opted in
   */
  create: async ({
    userId, user, type, title, body, icon = '🔔',
    matchScore = null, relatedLostItemId = null,
    relatedFoundItemId = null, relatedClaimId = null,
    channels = ['in-app'],
  }) => {
    try {
      const notif = await Notification.create({
        userId, type, title, body, icon, matchScore,
        relatedLostItemId, relatedFoundItemId, relatedClaimId, channels,
      });
      logger.info(`Notification created [${type}] for user ${userId}`);
      return notif;
    } catch (err) {
      logger.error(`Notification create failed: ${err.message}`);
    }
  },

  /**
   * Trigger match found notifications (in-app + email + WhatsApp)
   */
  notifyMatchFound: async (user, lostItem, foundItem, score, confidence, reasons) => {
    const title = `Possible Match Found for Your Lost Item!`;
    const body = `TraceMate's AI found a ${confidence} confidence (${score}%) match for your lost "${lostItem.itemName}". Found item: "${foundItem.itemName}" at ${foundItem.foundLocation}.`;

    // In-app
    await notificationService.create({
      userId: user._id, user, type: 'match_found',
      title, body, icon: '🤖', matchScore: score,
      relatedLostItemId: lostItem._id,
      relatedFoundItemId: foundItem._id,
      channels: ['in-app', 'email', 'whatsapp'],
    });

    // Email
    emailService.sendMatchFoundEmail(user, lostItem, foundItem, score, reasons).catch(logger.error);

    // WhatsApp (only for high/medium confidence)
    if (confidence !== 'low') {
      whatsappService.sendMatchAlert(user, lostItem, foundItem, score, confidence).catch(logger.error);
    }
  },

  /**
   * Trigger claim approved notifications
   */
  notifyClaimApproved: async (user, lostItem, foundItem, adminNotes) => {
    await notificationService.create({
      userId: user._id, type: 'claim_approved',
      title: 'Your Claim Was Approved! 🎉',
      body: `Your claim for "${lostItem.itemName}" has been approved. Please collect from: ${foundItem.storageLocation || 'Security Office'}.`,
      icon: '✅',
      relatedLostItemId: lostItem._id,
      relatedFoundItemId: foundItem._id,
      channels: ['in-app', 'email', 'whatsapp'],
    });
    emailService.sendClaimApprovedEmail(user, lostItem, foundItem, adminNotes).catch(logger.error);
    whatsappService.sendClaimApproved(user, lostItem, foundItem).catch(logger.error);
  },

  /**
   * Trigger claim rejected notifications
   */
  notifyClaimRejected: async (user, lostItem, adminNotes) => {
    await notificationService.create({
      userId: user._id, type: 'claim_rejected',
      title: 'Claim Status Update',
      body: `Your claim for "${lostItem.itemName}" was reviewed but could not be approved. ${adminNotes ? 'Reason: ' + adminNotes : ''}`,
      icon: '📋',
      relatedLostItemId: lostItem._id,
      channels: ['in-app', 'email'],
    });
    emailService.sendClaimRejectedEmail(user, lostItem, adminNotes).catch(logger.error);
    whatsappService.sendClaimRejected(user, lostItem, adminNotes).catch(logger.error);
  },

  /**
   * Notify user that their item was submitted
   */
  notifyItemCreated: async (user, item, type) => {
    await notificationService.create({
      userId: user._id, type: 'item_created',
      title: `${type === 'lost' ? '📋 Lost' : '📦 Found'} Item Reported`,
      body: `Your report for "${item.itemName}" was submitted. We'll notify you when a match is found.`,
      icon: type === 'lost' ? '📋' : '📦',
      relatedLostItemId: type === 'lost' ? item._id : null,
      relatedFoundItemId: type === 'found' ? item._id : null,
      channels: ['in-app', 'email'],
    });
    emailService.sendItemCreatedEmail(user, item, type).catch(logger.error);
  },
};

module.exports = notificationService;
