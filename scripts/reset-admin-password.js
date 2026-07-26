// scripts/reset-admin-password.js
//
// One-off recovery script for YOUR OWN local dev database.
// 1. Lists every user currently flagged isAdmin: true (so you can see the email).
// 2. If you pass --email + --password, resets that user's password.
//
// Usage:
//   node scripts/reset-admin-password.js                 -> just list admins
//   node scripts/reset-admin-password.js --email you@x.com --password NewPass123!

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/apex";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.replace(/^--/, "").split("=");
    return [k, rest.join("=")];
  }),
);

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}`);

  const admins = await User.find({ isAdmin: true }).select("email createdAt");
  console.log(`\nUsers with isAdmin: true (${admins.length}):`);
  admins.forEach((u) => console.log(`  - ${u.email}  (created ${u.createdAt})`));

  if (admins.length === 0) {
    console.log("\nNo admin user found. You'll need to register a new account");
    console.log("and then set isAdmin: true on it manually (see below).");
  }

  if (args.email && args.password) {
    const user = await User.findOne({ email: args.email.toLowerCase().trim() });
    if (!user) {
      console.log(`\nNo user found with email ${args.email}`);
    } else {
      user.passwordHash = await bcrypt.hash(args.password, 12);
      user.isAdmin = true; // make sure it's set while we're here
      await user.save();
      console.log(`\n✅ Password reset for ${user.email}. isAdmin is now true.`);
      console.log(`   Log in with that email + the new password, then refresh/relogin`);
      console.log(`   if the admin button doesn't show immediately (session caches isAdmin).`);
    }
  } else if (admins.length > 0) {
    console.log(`\nTo reset a password, re-run with:`);
    console.log(`  node scripts/reset-admin-password.js --email=${admins[0].email} --password=YourNewPassword`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
