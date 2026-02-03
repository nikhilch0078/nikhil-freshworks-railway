const mongoose = require("mongoose");

const CallSchema = new mongoose.Schema(
  {
    callId: {
      type: String,
      required: true,
      unique: true,
    },
    callerPhone: {
      type: String,
      required: true,
    },
    responderEmail: {
      type: String,
      required: true,
    },
    callName: {
      type: String, // optional (example: Incoming Call, Support Call)
    },
    callDuration: {
      type: Number, // duration in seconds
      default: 0,
    },
    source: {
      type: String,
      default: "postman",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Call", CallSchema);