import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { AuthContext } from '../contexts/AuthContext.jsx';
import {
  FaSignOutAlt,
  FaPaperPlane,
  FaUserCircle,
  FaSearch,
  FaGlobe,
  FaClock,
  FaEnvelope,
  FaCheckCircle,
  FaUserPlus,
  FaCommentDots,
  FaBan
} from 'react-icons/fa';

/**
 * Chat component provides global, private and recent messaging views.  The
 * component maintains conversation state in local state and communicates
 * with the backend via socket.io for real‐time messaging.  When the
 * component is first mounted it fetches the list of recent conversations
 * from the backend API and hydrates each conversation with the full
 * recipient user object using a dedicated user endpoint.  This ensures
 * that the recent tab continues to display previous contacts after a
 * refresh or server restart, without requiring the user to manually
 * search for usernames.  If fetching the user fails, the conversation
 * still appears with a placeholder name.
 */
function Chat() {
  const { user, token, logout } = useContext(AuthContext);

  const [activeTab, setActiveTab] = useState('global');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const [conversations, setConversations] = useState([]);
  const [messageRequests, setMessageRequests] = useState([]);

  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const [trustedUsers, setTrustedUsers] = useState(new Set());

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const trustedUsersRef = useRef(trustedUsers);
  const conversationsRef = useRef(conversations);
  const messageRequestsRef = useRef(messageRequests);
  const activeTabRef = useRef(activeTab);
  const selectedRecipientRef = useRef(selectedRecipient);

  useEffect(() => { trustedUsersRef.current = trustedUsers; }, [trustedUsers]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { messageRequestsRef.current = messageRequests; }, [messageRequests]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { selectedRecipientRef.current = selectedRecipient; }, [selectedRecipient]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          logout();
          navigate('/login');
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [logout, navigate]);

  const loadTrustedFromStorage = () => {
    if (!user?.userId) return new Set();
    const stored = localStorage.getItem(`trusted_${user.userId}`);
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch (e) {
        return new Set();
      }
    }
    return new Set();
  };

  const saveTrustedToStorage = (trustedSet) => {
    if (user?.userId) {
      localStorage.setItem(`trusted_${user.userId}`, JSON.stringify([...trustedSet]));
    }
  };

  /**
   * Fetch the list of users the current user trusts.  Combines localStorage
   * and backend state and persists the merged set to localStorage.
   */
  const fetchTrustedUsers = async () => {
    const storedTrusted = loadTrustedFromStorage();
    setTrustedUsers(storedTrusted);
    trustedUsersRef.current = storedTrusted;

    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/users/trusted`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const backendSet = new Set(res.data || []);
      const merged = new Set([...storedTrusted, ...backendSet]);
      setTrustedUsers(merged);
      trustedUsersRef.current = merged;
      saveTrustedToStorage(merged);
    } catch (err) {
      console.warn('Failed to fetch trusted users from backend:', err);
    }
  };

  /**
   * Persist trust to both frontend state/storage and backend.
   */
  const trustUser = async (userId) => {
    setTrustedUsers(prev => {
      const newSet = new Set([...prev, userId]);
      saveTrustedToStorage(newSet);
      return newSet;
    });
    trustedUsersRef.current.add(userId);
    setMessageRequests(prev => prev.filter(r => r.user._id !== userId));

    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/api/users/trust/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Failed to trust user:', err);
    }
  };

  const untrustUser = (userId) => {
    setTrustedUsers(prev => {
      const next = new Set(prev);
      next.delete(userId);
      saveTrustedToStorage(next);
      return next;
    });
    trustedUsersRef.current.delete(userId);
  };

  /**
   * Fetch messages for either global or a specific private conversation.  This
   * is triggered when the active tab or selected recipient changes.  If
   * neither case applies the messages state is cleared.
   */
  const fetchMessages = async () => {
    if (activeTab === 'global') {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMessages(res.data);
      } catch (err) {
        console.error('Failed to load global messages:', err);
      }
    } else if (activeTab === 'private' && selectedRecipient) {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/messages?recipient=${selectedRecipient._id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMessages(res.data);
      } catch (err) {
        console.error('Failed to load private messages:', err);
      }
    } else {
      setMessages([]);
    }
  };

  /**
   * Fetches recent conversation metadata from the server.  The backend
   * returns an array of conversations where each item represents a
   * conversation between the current user and another participant, keyed by
   * the other participant's ID.  Because the conversation objects
   * themselves only contain the participant ID (and not the full user
   * profile) this function additionally fetches user details for each
   * participant.  This ensures that the recent tab persists across
   * refreshes and server restarts.  If a user lookup fails, the
   * conversation will still be displayed with a placeholder username.
   */
  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/messages/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const convList = res.data || [];
      if (convList.length === 0) {
        setConversations([]);
        return;
      }

      const participantIds = convList.map((c) => c._id || c.participantId);

      const users = await Promise.all(
        participantIds.map(async (id) => {
          try {
            const userRes = await axios.get(
              `${import.meta.env.VITE_API_URL}/api/users/${id}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            return userRes.data;
          } catch (err) {
            console.warn('Failed to fetch user details for conversation', id, err);
            return null;
          }
        })
      );

      const userMap = new Map();
      users.forEach((u) => {
        if (!u) return;
        const uid = u._id || u.id;
        if (uid) userMap.set(uid, u);
      });

      const enriched = convList.map((conv) => {
        const id = conv._id || conv.participantId;
        const userObj = userMap.get(id) || { _id: id, username: conv.username || `User ${id}` };
        return {
          user: userObj,
          lastMessage: conv.lastMessage || '',
          lastMessageTime: conv.lastMessageTime,
          unreadCount: conv.unreadCount || 0,
        };
      });

      enriched.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
      setConversations(enriched);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
      setConversations([]);
    }
  };

  /**
   * Fetch incoming message requests from users who are not yet trusted or
   * part of existing conversations.  Filters out any users that are
   * already in the trusted set.
   */
  const fetchMessageRequests = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/messages/requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const currentTrusted = trustedUsersRef.current;
      const filtered = (res.data || []).filter((r) => r?.user?._id && !currentTrusted.has(r.user._id));
      setMessageRequests(filtered);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
      setMessageRequests([]);
    }
  };

  useEffect(() => {
    if (!token || !user) return;

    const initialize = async () => {
      await fetchTrustedUsers();
      await fetchConversations();
      await fetchMessageRequests();
    };

    initialize();

    socketRef.current = io(import.meta.env.VITE_API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current.on('connect', () => console.log('✅ Socket connected'));
    socketRef.current.on('connect_error', (err) => {
      if (err.message?.includes('token') || err.message?.includes('Authentication')) {
        logout();
        navigate('/login');
      }
    });
    socketRef.current.on('message-error', (errMsg) => console.error('Message error:', errMsg));

    socketRef.current.on('receive-message', (message) => {
      if (!message.recipient) {
        if (activeTabRef.current === 'global') {
          setMessages((prev) => [...prev, message]);
        } else {
          setGlobalUnreadCount((prev) => prev + 1);
        }
        return;
      }

      if (message.sender._id === user.userId) {
        updateConversation(message.recipient, message.content, true);
        if (activeTabRef.current === 'private' && selectedRecipientRef.current?._id === message.recipient._id) {
          setMessages((prev) => [...prev, message]);
        }
      } else if (message.recipient._id === user.userId) {
        handleIncomingPrivateMessage(message);
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [token, user]);

  useEffect(() => {
    fetchMessages();
  }, [activeTab, selectedRecipient]);

  useEffect(() => {
    if (activeTab === 'private' && selectedRecipient) {
      setConversations((prev) =>
        prev.map((conv) =>
          conv.user._id === selectedRecipient._id ? { ...conv, unreadCount: 0 } : conv
        )
      );
    }
  }, [selectedRecipient, activeTab]);

  /**
   * Update or insert a conversation in the conversation list when a new
   * message arrives.  If the conversation already exists it updates the
   * lastMessage, lastMessageTime and unreadCount appropriately.  If the
   * conversation doesn't exist it creates a new entry.  Conversations are
   * sorted by most recent activity.
   */
  const updateConversation = (otherUser, messageContent, isFromMe) => {
    setConversations((prev) => {
      const existingIndex = prev.findIndex((c) => c.user._id === otherUser._id);
      const now = new Date().toISOString();

      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          lastMessage: messageContent,
          lastMessageTime: now,
          unreadCount: isFromMe ? updated[existingIndex].unreadCount : (updated[existingIndex].unreadCount || 0) + 1,
        };
        updated.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
        return updated;
      } else {
        return [
          {
            user: otherUser,
            lastMessage: messageContent,
            lastMessageTime: now,
            unreadCount: isFromMe ? 0 : 1,
          },
          ...prev,
        ];
      }
    });
  };

  /**
   * Handles an incoming private message from another user.  Depending on
   * whether the sender is trusted or already part of an existing
   * conversation, the message is either appended to the current thread,
   * routed to the recent conversations list or added as a message request.
   */
  const handleIncomingPrivateMessage = useCallback((message) => {
    const sender = message.sender;
    const isTrusted = trustedUsersRef.current.has(sender._id);
    const isInConversations = conversationsRef.current.some((c) => c.user._id === sender._id);
    const currentlyViewing = activeTabRef.current === 'private' && selectedRecipientRef.current?._id === sender._id;

    if (isTrusted || isInConversations) {
      updateConversation(sender, message.content, false);
      if (currentlyViewing) {
        setMessages((prev) => [...prev, message]);
      }
    } else {
      const isInRequests = messageRequestsRef.current.some((r) => r.user._id === sender._id);
      if (!isInRequests) {
        setMessageRequests((prev) => [
          {
            user: sender,
            lastMessage: message.content,
            receivedAt: new Date().toISOString(),
            unreadCount: 1,
          },
          ...prev,
        ]);
      } else {
        setMessageRequests((prev) =>
          prev.map((req) =>
            req.user._id === sender._id
              ? { ...req, lastMessage: message.content, receivedAt: new Date().toISOString() }
              : req
          )
        );
      }
    }
  }, [user?.userId]);

  /**
   * Accept a message request: trust the user, move the request to
   * conversations and switch to the private tab with the user selected.
   */
  const acceptMessageRequest = async (requestUser, lastMessage) => {
    await trustUser(requestUser._id);
    setConversations((prev) => {
      if (prev.some((c) => c.user._id === requestUser._id)) return prev;
      return [
        {
          user: requestUser,
          lastMessage: lastMessage || 'Conversation started',
          lastMessageTime: new Date().toISOString(),
          unreadCount: 0,
        },
        ...prev,
      ];
    });
    setSelectedRecipient(requestUser);
    setActiveTab('private');
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSearchResults(res.data);
      } catch (err) {
        console.error(err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, token]);

  /**
   * Send the current message.  Emits via socket.io depending on whether
   * the conversation is global or private.  Resets the input on send.
   */
  const sendMessage = () => {
    const content = newMessage.trim();
    if (!content || !socketRef.current) return;

    if (activeTab === 'global') {
      socketRef.current.emit('send-message', { content, recipientId: null });
    } else if (activeTab === 'private' && selectedRecipient && !selectedRecipient.hasBlockedMe && !selectedRecipient.isBlockedByMe) {
      socketRef.current.emit('send-message', { content, recipientId: selectedRecipient._id });
    }
    setNewMessage('');
  };

  /**
   * Handle the Enter key in the message input to send the message.  Allows
   * multi-line messages via shift+enter.
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Selects a user from the search results to initiate a private
   * conversation.  Clears the search query and results, updates state
   * accordingly and ensures the conversation appears in recent.
   */
  const selectUser = (userData) => {
    if (userData.hasBlockedMe) return;
    setSelectedRecipient(userData);
    setSearchQuery('');
    setSearchResults([]);
    setActiveTab('private');
    setMessageRequests((prev) => prev.filter((req) => req.user._id !== userData._id));

    setConversations((prev) => {
      if (prev.some((c) => c.user._id === userData._id)) return prev;
      return [
        {
          user: userData,
          lastMessage: 'Start a conversation...',
          lastMessageTime: new Date().toISOString(),
          unreadCount: 0,
        },
        ...prev,
      ];
    });
  };

  /**
   * Opens an existing conversation from the recent tab.
   */
  const openConversation = (conversation) => {
    setSelectedRecipient(conversation.user);
    setActiveTab('private');
  };

  /**
   * Toggle blocking or unblocking a user.  Unblocking simply flips the
   * `isBlockedByMe` flag on the selected recipient.  Blocking removes any
   * existing conversation and message requests with the user and untrusts
   * them to prevent future messages from automatically appearing.  After
   * toggling the block state the conversations and requests are refreshed
   * from the backend to reflect the latest state.
   */
  const toggleBlockUser = async (userToBlock) => {
    try {
      if (userToBlock.isBlockedByMe) {
        await axios.delete(`${import.meta.env.VITE_API_URL}/api/users/block/${userToBlock._id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSelectedRecipient((prev) => ({ ...prev, isBlockedByMe: false }));
      } else {
        await axios.post(`${import.meta.env.VITE_API_URL}/api/users/block/${userToBlock._id}`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
        untrustUser(userToBlock._id);
        setConversations((prev) => prev.filter((c) => c.user._id !== userToBlock._id));
        setMessageRequests((prev) => prev.filter((r) => r.user._id !== userToBlock._id));
        setSelectedRecipient(null);
        setActiveTab('global');
      }
      fetchConversations();
      fetchMessageRequests();
    } catch (err) {
      console.error('Block/unblock failed:', err);
    }
  };

  /**
   * Log the user out and redirect to login.
   */
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const unreadCount = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
  const requestsCount = messageRequests.length;

  return (
    <div className="flex h-screen bg-chat-background dark:bg-chat-darkBg text-gray-900 dark:text-gray-100 relative">
      <aside className="hidden md:flex flex-col w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Chat App</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Real-time messaging</p>
        </div>

        <div className="flex items-center space-x-3">
          <FaUserCircle className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Logged in as</p>
            <p className="font-semibold truncate">{user?.username}</p>
          </div>
        </div>

        {}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setActiveTab('global'); setSelectedRecipient(null); }}
            className={`py-2 text-sm font-medium rounded-md transition-colors relative ${
              activeTab === 'global' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <FaGlobe className="inline mr-1" /> Global
            {globalUnreadCount > 0 && activeTab !== 'global' && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                {globalUnreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('private'); }}
            className={`py-2 text-sm font-medium rounded-md transition-colors relative ${
              activeTab === 'private' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <FaSearch className="inline mr-1" /> Private
          </button>
          <button
            onClick={() => { setActiveTab('recent'); }}
            className={`py-2 text-sm font-medium rounded-md transition-colors relative ${
              activeTab === 'recent' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <FaClock className="inline mr-1" /> Recent
            {unreadCount > 0 && activeTab !== 'recent' && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('requests'); }}
            className={`py-2 text-sm font-medium rounded-md transition-colors relative ${
              activeTab === 'requests' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <FaEnvelope className="inline mr-1" /> Requests
            {requestsCount > 0 && activeTab !== 'requests' && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full">
                {requestsCount}
              </span>
            )}
          </button>
        </div>

        {}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {activeTab === 'global' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Everyone in the app can see messages here.</p>
              <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <p className="text-xs text-blue-600 dark:text-blue-300">🌐 Messages are public</p>
              </div>
            </div>
          )}

          {activeTab === 'private' && (
            <div className="space-y-4">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search username to start private chat..."
                  className="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md max-h-48 overflow-auto shadow-lg">
                    {searchResults.map((u) => (
                      <div
                        key={u._id}
                        onClick={() => !u.hasBlockedMe && selectUser(u)}
                        className={`px-4 py-2 flex items-center gap-2 ${
                          u.hasBlockedMe ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        <FaUserPlus className={u.hasBlockedMe ? 'text-gray-400' : 'text-green-500'} />
                        <span>{u.username}</span>
                        {u.hasBlockedMe && <span className="text-xs text-red-500 ml-auto">(blocked you)</span>}
                        {u.isBlockedByMe && <span className="text-xs text-orange-500 ml-auto">(blocked)</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedRecipient ? (
                <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950 rounded-md flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FaUserCircle className="text-blue-500" />
                    <div>
                      <span className="font-medium">@{selectedRecipient.username}</span>
                      {trustedUsers.has(selectedRecipient._id) && (
                        <span className="ml-2 text-xs text-green-500 font-medium">✓ trusted</span>
                      )}
                    </div>
                  </div>
                    {!selectedRecipient.hasBlockedMe && (
                      <button
                        onClick={() => toggleBlockUser(selectedRecipient)}
                        className={`px-3 py-1 text-sm rounded-md ${
                          selectedRecipient.isBlockedByMe
                            ? 'bg-green-500 hover:bg-green-600 text-white'
                            : 'bg-red-500 hover:bg-red-600 text-white'
                        }`}
                      >
                        {selectedRecipient.isBlockedByMe ? 'Unblock' : 'Block'}
                      </button>
                    )}
                    {selectedRecipient.hasBlockedMe && (
                      <span className="text-red-500 text-sm flex items-center gap-1"><FaBan /> Blocked you</span>
                    )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">Search for a user above to start a private conversation.</p>
              )}
            </div>
          )}

          {activeTab === 'recent' && (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold mb-3">Recent Chats</h3>
              {conversations.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No recent chats. Start a private conversation using the Private tab.</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.user._id}
                    onClick={() => openConversation(conv)}
                    className="p-3 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FaUserCircle className="text-blue-500 text-xl" />
                        <div>
                          <p className="font-medium">
                            @{conv.user.username}
                            {trustedUsers.has(conv.user._id) && (
                              <span className="ml-1 text-xs text-green-500">✓</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 truncate max-w-[150px]">
                            {conv.lastMessage?.slice(0, 40) || 'No messages yet'}
                          </p>
                        </div>
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold mb-3">Message Requests</h3>
              {messageRequests.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No message requests. When someone new messages you, it will appear here.</p>
              ) : (
                messageRequests.map((req) => (
                  <div
                    key={req.user._id}
                    className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FaUserCircle className="text-yellow-600 text-xl" />
                        <div>
                          <p className="font-medium">@{req.user.username}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            {req.lastMessage?.slice(0, 40)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => acceptMessageRequest(req.user, req.lastMessage)}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-full flex items-center gap-1"
                      >
                        <FaCheckCircle size={12} /> Accept
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md"
        >
          <FaSignOutAlt className="mr-2" /> Logout
        </button>
      </aside>

      {}
      <div className="flex flex-col flex-1">
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b dark:border-gray-700 bg-white dark:bg-gray-900">
          <h1 className="text-lg md:text-xl font-semibold">
            {activeTab === 'global' && '🌐 Global Chat'}
            {activeTab === 'private' && (selectedRecipient ? `💬 Private chat with @${selectedRecipient.username}` : '🔒 Private Chat')}
            {activeTab === 'recent' && '📋 Recent Chats'}
            {activeTab === 'requests' && '📨 Message Requests'}
          </h1>
          <button
            onClick={handleLogout}
            className="md:hidden flex items-center px-2 py-1 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md"
          >
            <FaSignOutAlt className="mr-1" /> Logout
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scroll">
          {messages.map((msg) => {
            const isSelf = msg.sender._id === user?.userId;
            const messageTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={msg._id} className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-xs md:max-w-md break-words px-4 py-2 rounded-lg shadow-lg ${
                    isSelf
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <p className="text-sm font-semibold mb-1">{isSelf ? 'You' : msg.sender.username}</p>
                  <p>{msg.content}</p>
                  <p className="text-xs opacity-70 mt-1 text-right">{messageTime}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />

          {activeTab === 'private' && !selectedRecipient && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 pt-20">
              <FaCommentDots className="h-16 w-16 mb-4 opacity-50" />
              <p>Use the search bar in the sidebar to find a user and start a private chat.</p>
            </div>
          )}
          {activeTab === 'recent' && conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 pt-20">
              <FaClock className="h-16 w-16 mb-4 opacity-50" />
              <p>No recent chats yet. Start a private conversation from the Private tab.</p>
            </div>
          )}
          {activeTab === 'requests' && messageRequests.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 pt-20">
              <FaEnvelope className="h-16 w-16 mb-4 opacity-50" />
              <p>No pending message requests.</p>
            </div>
          )}
        </main>

        {(activeTab === 'global' || (activeTab === 'private' && selectedRecipient && !selectedRecipient.hasBlockedMe && !selectedRecipient.isBlockedByMe)) && (
          <footer className="p-4 md:p-6 border-t dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="flex items-center space-x-2">
              <input
                type="text"
                className="flex-1 px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim()}
                className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              >
                <FaPaperPlane className="mr-2" /> Send
              </button>
            </div>
          </footer>
        )}

        {activeTab === 'private' && selectedRecipient?.isBlockedByMe && (
          <div className="p-4 border-t dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-sm text-orange-500 font-medium">
            You have blocked @{selectedRecipient.username}. Unblock them to send messages.
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;