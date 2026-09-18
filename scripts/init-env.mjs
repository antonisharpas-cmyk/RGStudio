/**
 * Creates .env from .env.example on first run and fills in a strong
 * AUTH_SECRET, so `npm run setup` works on any machine with no extra steps.
 * If .env already exists it is left untouched.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV = ".env";
const EXAMPLE = ".env.example";

if (existsSync(ENV)) {
  console.log("· .env already exists — leaving it alone");
} else {
  if (!existsSync(EXAMPLE)) {
    console.error(`✗ ${EXAMPLE} is missing — cannot create ${ENV}`);
    process.exit(1);
  }
  copyFileSync(EXAMPLE, ENV);
  const secret = randomBytes(32).toString("base64");
  const contents = readFileSync(ENV, "utf8").replace(
    /AUTH_SECRET=".*"/,
    `AUTH_SECRET="${secret}"`,
  );
  writeFileSync(ENV, contents);
  console.log("✓ created .env with a fresh AUTH_SECRET");
  console.log("  Add your Stripe keys there when you are ready to take payments.");
}
