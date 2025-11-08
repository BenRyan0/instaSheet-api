// socket.js
const SOCKET_LIMITS = {
  maxConnections: 100,
  processingTimeout: 5 * 60 * 1000, // 5 minutes
  heartbeatInterval: 30000,
};

let io;

// Efficient Maps for O(1) lookups and cleanup
const activeSockets = new Map(); // socket.id -> metadata
const userSockets = new Map();   // userId -> socketId
const activeClients = new Map(); // clientId -> socket

// ---------------------------------------------
// Initialize Socket.IO
// ---------------------------------------------
const init = (server, options = {}) => {
  io = require("socket.io")(server, {
    ...options,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000,
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", (socket) => {
    const { userId, clientId } = socket.handshake.auth || {};

    // Reject invalid client
    if (!clientId) {
      console.warn("❌ Missing clientId — disconnecting");
      socket.disconnect(true);
      return;
    }

    console.log(`🔌 Connected: user=${userId}, client=${clientId}, socket=${socket.id}`);

    // ---------------------------------------------
    // Handle Reconnection / Duplicate Clients
    // ---------------------------------------------
    const oldSocket = activeClients.get(clientId);
    if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
      console.log(`♻️ Replacing old connection for clientId=${clientId}`);
      // Gracefully tell old socket to disconnect
      oldSocket.emit("force_disconnect", { reason: "Replaced by new connection" });
      oldSocket.disconnect(true);
    }

    // Register new connection
    activeClients.set(clientId, socket);
    if (userId) userSockets.set(userId, socket.id);

    // Store metadata
    activeSockets.set(socket.id, {
      socket,
      userId,
      clientId,
      intervals: new Set(),
      timeouts: new Set(),
      isProcessing: false,
    });

    // ---------------------------------------------
    // Cleanup logic on disconnect
    // ---------------------------------------------
    socket.on("disconnect", (reason) => {
      console.warn(`⚠️ Disconnected socket=${socket.id} → ${reason}`);

      const data = activeSockets.get(socket.id);
      if (data) {
        // Clear intervals and timeouts
        data.intervals.forEach(clearInterval);
        data.timeouts.forEach(clearTimeout);

        activeSockets.delete(socket.id);
        if (data.userId) userSockets.delete(data.userId);
        if (data.clientId) activeClients.delete(data.clientId);
      }

      console.log(`🧹 Cleaned up socket=${socket.id}`);
    });

    // ---------------------------------------------
    // Example: webhook processing handler
    // ---------------------------------------------
    const webhookController = require("./controllers/instantly/webhookController");

    socket.on("new_email_added", async (payload) => {
      const socketData = activeSockets.get(socket.id);
      if (!socketData) return;

      if (socketData.isProcessing) {
        console.log(`⚠️ Ignored trigger for ${socket.id} — still processing.`);
        socket.emit("processing_busy", { message: "Still processing previous request" });
        return;
      }

      socketData.isProcessing = true;
      console.log(`🚀 Processing new_email_added for ${socket.id}`);

      // Set processing timeout
      const processingTimeout = setTimeout(() => {
        if (socketData.isProcessing) {
          socketData.isProcessing = false;
          socket.emit("processing_error", { message: "Processing timeout exceeded" });
        }
      }, SOCKET_LIMITS.processingTimeout);
      socketData.timeouts.add(processingTimeout);

      try {
        const opts = {
          is_unread: true,
          delayMs: 300,
          pageLimit: 2,
          emailsPerLead: 1,
          concurrency: 1,
          maxEmails: 100,
          maxPages: 5,
          aiInterestThreshold: 1,
        };

        console.log("📨 Payload received:", payload);

        await webhookController.encodeInterestedRepliesByWebhook({
          opts,
          sheetName: payload.sheetName || "MCA Loan",
          sheetNameForPartnership: payload.sheetNameForPartnership || "Partner MCA",
          sheetNameForSBA: payload.sheetNameForSBA || "SBA-MCA",
          autoAppend: true,
          descriptionExtraction: true,
        });

        console.log(`✅ Completed encode for ${socket.id}`);
        socket.emit("processing_done", { message: "Completed successfully" });
      } catch (err) {
        console.error(`❌ Error during processing for ${socket.id}:`, err);
        socket.emit("processing_error", { message: err.message });
      } finally {
        socketData.isProcessing = false;
        clearTimeout(processingTimeout);
        socketData.timeouts.delete(processingTimeout);
      }
    });
  });

  console.log("✅ Socket.IO initialized");
  return io;
};

// ---------------------------------------------
// Accessors
// ---------------------------------------------
const getIO = () => io;

const getUserSocket = (userId) => {
  const socketId = userSockets.get(userId);
  const data = socketId ? activeSockets.get(socketId) : null;
  return data?.socket || null;
};

const getSocketByClientId = (clientId) => activeClients.get(clientId) || null;

const setUserSocket = (userId, socketId) => {
  userSockets.set(userId, socketId);
};

// ---------------------------------------------
module.exports = {
  init,
  getIO,
  getUserSocket,
  setUserSocket,
  getSocketByClientId,
};
