// src/services/processedEmailService.js
const redisClient = require('../config/redisClient');

const PREFIX = 'insta:processed_emails:';

async function getProcessedEmails(campaignId) {
  const key = `${PREFIX}${campaignId}`;
  const members = await redisClient.sMembers(key);
  return new Set(members);
}

async function addProcessedEmail(campaignId, emailKey) {
  const key = `${PREFIX}${campaignId}`;
  await redisClient.sAdd(key, emailKey);
}

module.exports = {
  getProcessedEmails,
  addProcessedEmail,
};
