// scripts/bootstrap-admin.js
//
// Creates your admin account (or promotes an existing one) — no MongoDB
// Compass/shell needed. Uses the same User model and connection string
// your server already uses.
//
// Usage:
//   node scripts/bootstrap-admin.js --email=you@example.com --password=YourPassword123!
//
// If a user with that email already exists, it just sets isAdmin: true
// and (if you also pass --password) resets the password too.

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
  if (!args.email || !args.password) {
    console.log("Usage: node scripts/bootstrap-admin.js --email=you@example.com --password=YourPassword");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}`);

  const email = args.email.toLowerCase().trim();
  let user = await User.findOne({ email });
  const passwordHash = await bcrypt.hash(args.password, 12);

  if (user) {
    user.passwordHash = passwordHash;
    user.isAdmin = true;
    await user.save();
    console.log(`\n✅ Existing user ${email} updated: password reset, isAdmin = true.`);
  } else {
    user = await User.create({ email, passwordHash, isAdmin: true, profile: {} });
    console.log(`\n✅ Created new admin user: ${email}`);
  }

  console.log(`\nLog in with that email + password in the browser.`);
  console.log(`If you have an old tab open, log out / clear cookies first —`);
  console.log(`the admin flag is cached in the session at login time.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
