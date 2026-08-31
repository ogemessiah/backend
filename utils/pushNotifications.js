const axios = require('axios');

const sendPushNotification = async ({
  expoPushToken,
  title,
  body,
  data = {}
}) => {

  if (!expoPushToken) {
    console.log(
      'No Expo push token — notification not sent'
    );

    return null;
  }

  try {

    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      {
        to: expoPushToken,
        sound: 'default',
        title,
        body,
        data
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(
      'Push notification sent:',
      JSON.stringify(
        response.data,
        null,
        2
      )
    );

    return response.data;

  } catch (error) {

    console.error(
      'Push notification error:',
      error.response?.data ||
      error.message
    );

    return null;
  }
};

module.exports = {
  sendPushNotification
};