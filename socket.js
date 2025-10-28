// const instantlyAiController = require("./controllers/instantlyAiController");
let io;
let allCustomer = [];
let allSeller = [];
let admin = {};
let userSockets = {}; // Stores { userId: socketId } for notification delivery

const init = (server, options = {}) => {
  io = require("socket.io")(server, options);

  io.on("connection", (socket) => {
    console.log(`New socket connected: ${socket.id}`);
    let timeChange;
    if (timeChange) clearInterval(timeChange);
    setInterval(() => {
      socket.emit("message", new Date());
    }, 3000);

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`Disconnected: ${socket.id}`);
      remove(socket.id);
      io.emit("activeSeller", allSeller);
      io.emit("activeCustomer", allCustomer);

      // Remove from userSockets
      Object.keys(userSockets).forEach((userId) => {
        if (userSockets[userId] === socket.id) {
          delete userSockets[userId];
          console.log(` Removed ${userId} from active sockets.`);
        }
      });
    });

    const webhookController = require("./controllers/instantly/webhookController");
   
    socket.on("new_email_added", async (payload) => {
      if (socket.data.isProcessing) {
        console.log(`Ignored new trigger for ${socket.id} — still processing.`);
        socket.emit("processing_busy", {
          message: "Still processing previous request",
        });
        return;
      }

      socket.data.isProcessing = true;
      console.log(`Processing new_email_added for ${socket.id}`);

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

        await webhookController.encodeInterestedRepliesByWebhook({
          opts,
          sheetName: payload.sheetName || "InstaSheet_Test",
          // sheetName: payload.sheetName || "DefaultSheet",
          autoAppend: true,
          // autoAppend: payload.autoAppend || true,
          descriptionExtraction: true,
        });

        console.log(`Completed encode for ${socket.id}`);
        socket.emit("processing_done", { message: "Completed successfully" });
      } catch (err) {
        console.error(`Error during processing for ${socket.id}:`, err);
        socket.emit("processing_error", { message: err.message });
      } finally {
        socket.data.isProcessing = false;
      }
    });
  });
  return io;
};

// Remove user by socket ID
const remove = (socketId) => {
  allCustomer = allCustomer.filter((c) => c.socketId !== socketId);
  allSeller = allSeller.filter((s) => s.socketId !== socketId);
};

// Get Socket.io instance
const getIO = () => io;

// Get user socket by userId
const getUserSocket = (userId) => userSockets[userId];

module.exports = { init, getIO, getUserSocket };
