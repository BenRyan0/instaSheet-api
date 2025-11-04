const SOCKET_LIMITS = {
  maxConnections: 100,
  processingTimeout: 5 * 60 * 1000, // 5 minutes
  heartbeatInterval: 30000,
};

let io;
// Use Maps for better memory management and O(1) lookups
const activeSockets = new Map(); // Stores socket instances with metadata
const userSockets = new Map(); // userId to socketId mapping

const init = (server, options = {}) => {
  io = require("socket.io")(server, {
    ...options,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000,
    maxHttpBufferSize: 1e6, // 1MB
  });

  io.on("connection", (socket) => {
    // Check connection limit
    if (activeSockets.size >= SOCKET_LIMITS.maxConnections) {
      socket.emit('error', { message: 'Server connection limit reached' });
      socket.disconnect(true);
      return;
    }

    console.log(`New socket connected: ${socket.id}`);
    
    // Store socket metadata
    const timeInterval = setInterval(() => {
      socket.emit("message", new Date());
    }, 3000);
    
    activeSockets.set(socket.id, {
      socket,
      connectedAt: Date.now(),
      heartbeat: Date.now(),
      intervals: new Set([timeInterval]),
      timeouts: new Set(),
      isProcessing: false
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`Disconnected: ${socket.id}`);
      
      // Clean up socket resources
      const socketData = activeSockets.get(socket.id);
      if (socketData) {
        // Clear all intervals
        for (const interval of socketData.intervals) {
          clearInterval(interval);
        }
        // Clear all timeouts
        for (const timeout of socketData.timeouts) {
          clearTimeout(timeout);
        }
        // Remove socket data
        activeSockets.delete(socket.id);
      }

      // Remove from userSockets mapping
      for (const [userId, id] of userSockets.entries()) {
        if (id === socket.id) {
          userSockets.delete(userId);
          console.log(`Removed ${userId} from active sockets.`);
          break;
        }
      }
    });

    const webhookController = require("./controllers/instantly/webhookController");
   
    socket.on("new_email_added", async (payload) => {
      const socketData = activeSockets.get(socket.id);
      if (!socketData) return;

      if (socketData.isProcessing) {
        console.log(`Ignored new trigger for ${socket.id} — still processing.`);
        socket.emit("processing_busy", {
          message: "Still processing previous request",
        });
        return;
      }

      socketData.isProcessing = true;
      console.log(`Processing new_email_added for ${socket.id}`);

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

        console.log("payload")
        console.log(payload)

        await webhookController.encodeInterestedRepliesByWebhook({
          opts,
          sheetName: payload.sheetName || "MCA Loan",
          sheetNameForPartnership: payload.sheetNameForPartnership || "Partner MCA",
          autoAppend: true,
          descriptionExtraction: true,
        });

        console.log(`Completed encode for ${socket.id}`);
        socket.emit("processing_done", { message: "Completed successfully" });
      } catch (err) {
        console.error(`Error during processing for ${socket.id}:`, err);
        socket.emit("processing_error", { message: err.message });
      } finally {
        socketData.isProcessing = false;
        socketData.timeouts.delete(processingTimeout);
        clearTimeout(processingTimeout);
      }
    });
  });
  return io;
};

// Get Socket.io instance
const getIO = () => io;

// Get user socket by userId
const getUserSocket = (userId) => {
  const socketId = userSockets.get(userId);
  if (socketId) {
    const socketData = activeSockets.get(socketId);
    return socketData?.socket;
  }
  return null;
};

// Associate user ID with socket
const setUserSocket = (userId, socketId) => {
  userSockets.set(userId, socketId);
};

module.exports = { init, getIO, getUserSocket, setUserSocket };
