/**
 * Environment configuration for the local control plane.
 * Replaces Cloudflare Workers env bindings with process.env + dotenv.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  // Server
  PORT: parseInt(env("PORT", "8787"), 10),

  // Secrets
  TOKEN_ENCRYPTION_KEY: env("TOKEN_ENCRYPTION_KEY"),
  REPO_SECRETS_ENCRYPTION_KEY: env("REPO_SECRETS_ENCRYPTION_KEY"),
  MODAL_API_SECRET: env("MODAL_API_SECRET"),
  INTERNAL_CALLBACK_SECRET: env("INTERNAL_CALLBACK_SECRET"),

  // GitHub App
  GITHUB_APP_ID: env("GITHUB_APP_ID"),
  GITHUB_APP_PRIVATE_KEY: env("GITHUB_APP_PRIVATE_KEY"),
  GITHUB_APP_INSTALLATION_ID: env("GITHUB_APP_INSTALLATION_ID"),
  GITHUB_CLIENT_ID: env("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: env("GITHUB_CLIENT_SECRET"),

  // URLs
  DEPLOYMENT_NAME: env("DEPLOYMENT_NAME", "local"),
  WORKER_URL: env("WORKER_URL", "http://localhost:8787"),
  WEB_APP_URL: env("WEB_APP_URL", "http://localhost:3000"),
  SANDBOX_MANAGER_URL: env("SANDBOX_MANAGER_URL", "http://localhost:8000"),

  // Sandbox lifecycle
  SANDBOX_INACTIVITY_TIMEOUT_MS: env("SANDBOX_INACTIVITY_TIMEOUT_MS", "600000"),

  // Logging
  LOG_LEVEL: env("LOG_LEVEL", "info"),

  // SQLite data directory
  DATA_DIR: env("DATA_DIR", path.resolve(__dirname, "..", "data")),
};
