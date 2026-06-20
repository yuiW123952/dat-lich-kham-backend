const fetch = require('node-fetch');

async function sendPush(expoPushToken, title, body, data = {}) {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return;
  try {
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: expoPushToken, title, body, data, sound: 'default' }),
    });
    const result = await resp.json();
    if (result?.data?.status === 'error') {
      console.log('Expo push error:', result.data.message);
    }
  } catch (e) {
    console.log('Push error:', e.message);
  }
}

module.exports = { sendPush };
