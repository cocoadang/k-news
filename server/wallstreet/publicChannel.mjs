// Owner-created channel, confirmed in Telegram Web on 2026-11-15.
// Use the stable ID so changing/releasing a public username cannot redirect alerts.
export const PUBLIC_CHANNEL_ID = '-1004441977675';
export function isApprovedDeliveryRecipient(value) {
  return value === PUBLIC_CHANNEL_ID || /^[1-9]\d*$/.test(value || '');
}
