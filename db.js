import mongoose from 'mongoose';

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/syncode';

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () =>
  console.warn('⚠️ MongoDB disconnected'),
);

export default connectDB;
