import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import User from './models/User.js';
import Message from './models/Message.js';

dotenv.config();
 

const app = express();
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

const generateToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};


app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ message: 'All fields required' });

  try {
    if (await User.findOne({ email })) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, email, password: hashedPassword }).save();
    const token = generateToken(user._id);
    res.status(201).json({ token, userId: user._id, username: user.username });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'All fields required' });

  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const token = generateToken(user._id);
    res.json({ token, userId: user._id, username: user.username });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/messages', verifyJWT, async (req, res) => {
  try {
    const { recipient } = req.query;
    let query = { recipient: null };
    if (recipient) {
      query = {
        $or: [
          { sender: req.userId, recipient },
          { sender: recipient, recipient: req.userId }
        ]
      };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('sender', 'username')
      .populate('recipient', 'username');

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

app.get('/api/messages/conversations', verifyJWT, async (req, res) => {
  try {
    const userId = req.userId;
    const currentUser = await User.findById(userId);
    const blockedByMe = currentUser.blockedUsers.map(id => id.toString());
    const blockedMe = await User.find({ blockedUsers: userId }).distinct('_id');
    const blockedMeIds = blockedMe.map(id => id.toString());
    const excludeUsers = [...blockedByMe, ...blockedMeIds];

    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: userId, recipient: { $ne: null } },
            { recipient: userId, sender: { $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$sender', userId] },
              '$recipient',
              '$sender'
            ]
          },
          lastMessage: { $last: '$content' },
          lastMessageTime: { $last: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$recipient', userId] }, { $eq: ['$read', false] }] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { lastMessageTime: -1 } }
    ]);

    const filtered = conversations.filter(conv => !excludeUsers.includes(conv._id.toString()));

    const userIds = filtered.map(c => c._id);
    const users = await User.find({ _id: { $in: userIds } }).select('username _id');
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const result = filtered.map(conv => ({
      user: userMap.get(conv._id.toString()),
      lastMessage: conv.lastMessage,
      lastMessageTime: conv.lastMessageTime,
      unreadCount: conv.unreadCount
    })).filter(conv => conv.user);

    res.json(result);
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

app.get('/api/messages/requests', verifyJWT, async (req, res) => {
  try {
    const userId = req.userId;
    const currentUser = await User.findById(userId);
    const blockedByMe = currentUser.blockedUsers.map(id => id.toString());
    const blockedMe = await User.find({ blockedUsers: userId }).distinct('_id');
    const blockedMeIds = blockedMe.map(id => id.toString());
    const excludeUsers = [...blockedByMe, ...blockedMeIds];

    const senders = await Message.distinct('sender', {
      recipient: userId,
      sender: { $ne: userId }
    });

    const repliedTo = await Message.distinct('recipient', {
      sender: userId,
      recipient: { $in: senders }
    });

    const requestSenderIds = senders.filter(id => !repliedTo.includes(id) && !excludeUsers.includes(id.toString()));

    const requests = await Promise.all(requestSenderIds.map(async (senderId) => {
      const lastMsg = await Message.findOne({
        sender: senderId,
        recipient: userId
      }).sort({ createdAt: -1 }).limit(1);
      const user = await User.findById(senderId).select('username _id');
      if (!user || !lastMsg) return null;
      return {
        user,
        lastMessage: lastMsg.content,
        receivedAt: lastMsg.createdAt
      };
    }));

    res.json(requests.filter(r => r !== null));
  } catch (err) {
    console.error('Error fetching message requests:', err);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

app.get('/api/users/search', verifyJWT, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);
  try {
    const currentUser = await User.findById(req.userId);
    const blockedByIds = await User.find({ blockedUsers: req.userId }).distinct('_id');

    const users = await User.find({
      username: { $regex: q, $options: 'i' },
      _id: { $ne: req.userId }
    }).select('_id username blockedUsers').limit(10);

    const results = users.map(user => ({
      _id: user._id,
      username: user.username,
      isBlockedByMe: currentUser.blockedUsers.includes(user._id),
      hasBlockedMe: blockedByIds.some(id => id.toString() === user._id.toString())
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: 'Search failed' });
  }
});

app.post('/api/users/block/:userId', verifyJWT, async (req, res) => {
  try {
    const currentUserId = req.userId;
    const userToBlockId = req.params.userId;

    if (currentUserId === userToBlockId) {
      return res.status(400).json({ message: 'Cannot block yourself' });
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser.blockedUsers.includes(userToBlockId)) {
      currentUser.blockedUsers.push(userToBlockId);
      await currentUser.save();
    }
    res.json({ message: 'User blocked successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to block user' });
  }
});

app.delete('/api/users/block/:userId', verifyJWT, async (req, res) => {
  try {
    const currentUserId = req.userId;
    const userToUnblockId = req.params.userId;

    const currentUser = await User.findById(currentUserId);
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      id => id.toString() !== userToUnblockId
    );
    await currentUser.save();
    res.json({ message: 'User unblocked successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to unblock user' });
  }
});

app.get('/api/users/trusted', verifyJWT, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    res.json(currentUser.trustedUsers.map(id => id.toString()));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch trusted users' });
  }
});

app.post('/api/users/trust/:userId', verifyJWT, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    const userToTrustId = req.params.userId;
    if (!currentUser.trustedUsers.map(id => id.toString()).includes(userToTrustId)) {
      currentUser.trustedUsers.push(userToTrustId);
      await currentUser.save();
    }
    res.json({ message: 'User trusted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to trust user' });
  }
});

app.delete('/api/users/trust/:userId', verifyJWT, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    currentUser.trustedUsers = currentUser.trustedUsers.filter(
      id => id.toString() !== req.params.userId
    );
    await currentUser.save();
    res.json({ message: 'User untrusted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to untrust user' });
  }
});


app.post('/api/users/bulk', verifyJWT, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) return res.status(400).json({ message: 'Invalid userIds' });

    const users = await User.find({ _id: { $in: userIds } }).select('username _id');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});


io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: token missing'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    return next(new Error('Authentication error: invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`📡 User connected: ${socket.userId}`);
  socket.join(`user:${socket.userId}`);

  socket.on('send-message', async ({ content, recipientId }) => {
    if (!content?.trim()) return;

    try {
      const senderId = socket.userId;

      if (recipientId) {
        const [sender, recipient] = await Promise.all([
          User.findById(senderId),
          User.findById(recipientId)
        ]);
        if (sender.blockedUsers.includes(recipientId) || recipient.blockedUsers.includes(senderId)) {
          socket.emit('message-error', 'Cannot send message: you or the recipient has blocked the other.');
          return;
        }
      }

      const message = new Message({
        sender: senderId,
        recipient: recipientId || null,
        content: content.trim()
      });

      await message.save();

      const populated = await message.populate([
        { path: 'sender', select: 'username' },
        { path: 'recipient', select: 'username' }
      ]);

      const messageData = {
        _id: message._id,
        content: populated.content,
        sender: { _id: populated.sender._id, username: populated.sender.username },
        recipient: populated.recipient ? { _id: populated.recipient._id, username: populated.recipient.username } : null,
        createdAt: populated.createdAt,
      };

      if (recipientId) {
        socket.emit('receive-message', messageData);
        io.to(`user:${recipientId}`).emit('receive-message', messageData);
      } else {
        io.emit('receive-message', messageData);
      }
    } catch (err) {
      console.error('Error broadcasting message:', err.message);
      socket.emit('message-error', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`👋 User disconnected: ${socket.userId}`);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));