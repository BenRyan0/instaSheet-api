const { responseReturn } = require("../../utils/response");

class databaseController {
  flushRedisDatabase = async (req, res) => {
    try {
      const cleared = await clearRedisData();

      if (cleared) {
        responseReturn(res, 200, {
          message: "Redis Database is Flushed successfuly",
        });
      } else {
        responseReturn(res, 500, {
          error: "Flushing the redis database, please try again",
        });
      }
    } catch (error) {
      console.log(error);
      responseReturn(res, 500, {
        error: "Flushing the redis database, please try again",
      });
    }
  };
}

module.exports = new databaseController();
