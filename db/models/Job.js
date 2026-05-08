import mongoose from 'mongoose';
const JobSchema = new mongoose.Schema({
    company: String, title: String, platform: String, status: { type: String, default: 'Pending' }, appliedDate: { type: Date, default: Date.now }
});
export const Job = mongoose.model('Job', JobSchema);