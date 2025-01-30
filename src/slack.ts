import axios from 'axios';

export const sendFormattedSlackNotification = async (title: string, fields: {[key: string]: string}) => {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL as string;
  
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: title
      }
    },
    {
      type: 'section',
      fields: Object.entries(fields).map(([key, value]) => ({
        type: 'mrkdwn',
        text: `*${key}:*\n${value}`
      }))
    }
  ];

  try {
    await axios.post(webhookUrl, { blocks });
  } catch (error) {
    console.error('Error sending Slack notification:', error);
  }
}
