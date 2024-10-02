const express = require('express');
const dotenv = require('dotenv');
const { StreamChat } = require('stream-chat');
const cors = require('cors');
const webPush = require('web-push');
const { clerkClient } = require('@clerk/clerk-sdk-node');
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(express.text({ type: '*/*' }));
app.use(cors("*"));


app.get('/api/get-token',  async (req, res) => {
    try {
      const { userId } = req.query;
  
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
  
      console.log('Calling get-token for user: ', userId);
  
      const streamClient = StreamChat.getInstance(
        process.env.STREAM_KEY,
        process.env.STREAM_SECRET
      );
  
      const expirationTime = Math.floor(Date.now() / 1000) + 60 * 60; 
      const issuedAt = Math.floor(Date.now() / 1000) - 60;
  
      const token = streamClient.createToken(userId, expirationTime, issuedAt);
  
      return res.status(200).json({ token });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/push-webhook', async (req, res) => {
    try {
      const streamClient = StreamChat.getInstance(
        process.env.STREAM_KEY,
        process.env.STREAM_SECRET
      );
  
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers['x-signature'];
  
      const validRequest = streamClient.verifyWebhook(rawBody, signature || '');
  
      if (!validRequest) {
        return res.status(401).json({ error: 'Webhook signature invalid' });
      }
  
      const event = JSON.parse(rawBody);
  
      console.log('Push web hook body: ', JSON.stringify(event));
  
      const sender = event.user;
      const recipientIds = event.channel.members
        .map((member) => member.user_id)
        .filter((id) => id !== sender.id);
  
      const channelId = event.channel.id;
  
      const recipients = (
        await clerkClient.users.getUserList({
          userId: recipientIds,
        })
      ).filter((user) => !user.unsafeMetadata.mutedChannels?.includes(channelId));
  
      const pushPromises = recipients.map((recipient) => {
        const subscriptions = recipient.privateMetadata.subscriptions || [];
  
        return subscriptions.map((subscription) =>
          webPush
            .sendNotification(
              subscription,
              JSON.stringify({
                title: sender.name,
                body: event.message.text,
                icon: sender.image,
                image:
                  event.message.attachments[0]?.image_url ||
                  event.message.attachments[0]?.thumb_url,
                channelId,
              }),
              {
                vapidDetails: {
                  subject: 'mailto:mkaidev88@outlook.com',
                  publicKey: process.env.WEB_PUSH_PUBLIC_KEY,
                  privateKey: process.env.WEB_PUSH_PRIVATE_KEY,
                },
              }
            )
            .catch((error) => {
              console.error('Error sending push notification: ', error);
              if (error instanceof webPush.WebPushError && error.statusCode === 410) {
                console.log('Push subscription expired, deleting...');
  
                clerkClient.users.updateUser(recipient.id, {
                  privateMetadata: {
                    subscriptions: recipient.privateMetadata.subscriptions?.filter(
                      (s) => s.endpoint !== subscription.endpoint
                    ),
                  },
                });
              }
            })
        );
      });
  
      await Promise.all(pushPromises.flat());
  
      res.status(200).json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


app.post('/api/register-push', async (req, res) => {
  try {
    const newSubscription = req.body;

    if (!newSubscription) {
      return res.status(400).json({ error: 'Missing push subscription in body' });
    }

    console.log('Received push subscription to add:', newSubscription);

    const { userId, sessionId } = req.body;

    if (!userId || !sessionId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await clerkClient.users.getUser(userId);

    const userSubscriptions = user.privateMetadata.subscriptions || [];

    const updatedSubscriptions = userSubscriptions.filter(
      (subscription) => subscription.endpoint !== newSubscription.endpoint
    );

    updatedSubscriptions.push({ ...newSubscription, sessionId });

    await clerkClient.users.updateUser(userId, {
      privateMetadata: { subscriptions: updatedSubscriptions },
    });

    return res.status(200).json({ message: 'Push subscription saved' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/register-push', async (req, res) => {
  try {
    const subscriptionToDelete = req.body;

    if (!subscriptionToDelete) {
      return res.status(400).json({ error: 'Missing push subscription in body' });
    }

    console.log('Received push subscription to delete:', subscriptionToDelete);

    const { userId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await clerkClient.users.getUser(userId);

    const userSubscriptions = user.privateMetadata.subscriptions || [];

    const updatedSubscriptions = userSubscriptions.filter(
      (subscription) => subscription.endpoint !== subscriptionToDelete.endpoint
    );

    await clerkClient.users.updateUser(userId, {
      privateMetadata: { subscriptions: updatedSubscriptions },
    });

    return res.status(200).json({ message: 'Push subscription deleted' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/', (req, res) => {
   res.send('API is running...');
});

app.listen(port, () => {
   console.log(`Server is running on port ${port}`);
});
