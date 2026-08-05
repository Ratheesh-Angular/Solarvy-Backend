import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  createAdminUser,
  findAdminById,
  findAdminByUsername,
  updateAdminPasswordHash,
} from "../repositories/admin.repository.js";

const TOKEN_EXPIRY = "8h";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

export async function seedAdminUser() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return { action: "skipped", reason: "missing_env" };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await findAdminByUsername(username);

  if (existing) {
    await updateAdminPasswordHash(existing.id, passwordHash);
    console.log(`Admin credentials synced from env for: ${username}`);
    return { action: "synced", username };
  }

  const user = await createAdminUser(username, passwordHash);
  console.log(`Admin user created: ${user.username}`);
  return { action: "created", username: user.username };
}

export async function loginAdmin(username, password) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername || !password) {
    throw new Error("Username and password are required");
  }

  const admin = await findAdminByUsername(normalizedUsername);
  if (!admin) {
    throw new Error("Invalid username or password");
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    throw new Error("Invalid username or password");
  }

  const token = jwt.sign(
    { sub: admin.id, username: admin.username },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRY },
  );

  return {
    token,
    user: {
      id: admin.id,
      username: admin.username,
    },
  };
}

export async function verifyAdminToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const admin = await findAdminById(payload.sub);
    if (!admin) return null;
    return {
      id: admin.id,
      username: admin.username,
    };
  } catch {
    return null;
  }
}
