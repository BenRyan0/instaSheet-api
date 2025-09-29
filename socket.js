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
    if (timeChange) 
        clearInterval(timeChange)
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
