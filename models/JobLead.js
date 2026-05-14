import mongoose from 'mongoose';

const jobLeadSchema = new mongoose.Schema(
    {
        jobTitle: { type: String, required: true },
        company:  { type: String, default: 'Unknown' },
        url:      { type: String, required: true, unique: true },
        location: { type: String, default: 'Remote' },

        status: {
            type: String,
            enum: [
                'DISCOVERED',
                'ANALYZING_FORM',
                'APPLYING',
                'CAPTCHA_BLOCKED',
                'FAILED',
                'FAILED_NEEDS_HEALING',   // was missing
                'APPLIED',
                'MANUAL_REVIEW_NEEDED',   // was missing
            ],
            default: 'DISCOVERED',
        },

        lastKnownHtml:       { type: String, default: null },
        aiGeneratedSelector: { type: String, default: null },

        logs: [{
            timestamp: { type: Date, default: Date.now },
            message: String,
        }],
    },
    { timestamps: true }
);

export const JobLead = mongoose.model('JobLead', jobLeadSchema);
