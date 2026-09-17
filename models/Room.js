import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  lastCode: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'cpp',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  joinHistory: [
    {
      username: { type: String, required: true },
      joinedAt: { type: Date, default: Date.now },
    },
  ],
});

export default mongoose.model('Room', roomSchema);
