import bcrypt from "bcryptjs";
import { normalizePermissions } from "../config/adminPermissions.js";
import {
  createStaffAdminUser,
  deleteStaffAdminUser,
  findAdminByEmail,
  findAdminById,
  findAdminByUsername,
  listStaffAdminUsers,
  updateStaffAdminPassword,
  updateStaffAdminUser,
} from "../repositories/admin.repository.js";

function toStaffPublic(admin) {
  return {
    id: admin.id,
    email: admin.email,
    username: admin.username,
    permissions: admin.permissions || [],
    createdAt: admin.created_at,
  };
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function listStaffUsers() {
  const rows = await listStaffAdminUsers();
  return rows.map(toStaffPublic);
}

export async function createStaffUser({ email, password, permissions }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw Object.assign(new Error("A valid email is required"), {
      status: 400,
    });
  }
  if (!password || String(password).length < 8) {
    throw Object.assign(
      new Error("Password must be at least 8 characters"),
      { status: 400 },
    );
  }

  const existingEmail = await findAdminByEmail(normalizedEmail);
  if (existingEmail) {
    throw Object.assign(new Error("An account with this email already exists"), {
      status: 400,
    });
  }

  const existingUsername = await findAdminByUsername(normalizedEmail);
  if (existingUsername) {
    throw Object.assign(new Error("An account with this email already exists"), {
      status: 400,
    });
  }

  const normalizedPerms = normalizePermissions(permissions);
  const passwordHash = await bcrypt.hash(String(password), 12);
  const created = await createStaffAdminUser({
    username: normalizedEmail,
    email: normalizedEmail,
    passwordHash,
    permissions: normalizedPerms,
  });
  return toStaffPublic(created);
}

export async function updateStaffUser(id, { email, password, permissions }) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    throw Object.assign(new Error("Invalid user id"), { status: 400 });
  }

  const existing = await findAdminById(numericId);
  if (!existing || existing.is_super_admin) {
    throw Object.assign(new Error("Staff user not found"), { status: 404 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw Object.assign(new Error("A valid email is required"), {
      status: 400,
    });
  }

  const emailOwner = await findAdminByEmail(normalizedEmail);
  if (emailOwner && emailOwner.id !== numericId) {
    throw Object.assign(new Error("An account with this email already exists"), {
      status: 400,
    });
  }

  const usernameOwner = await findAdminByUsername(normalizedEmail);
  if (usernameOwner && usernameOwner.id !== numericId) {
    throw Object.assign(new Error("An account with this email already exists"), {
      status: 400,
    });
  }

  if (password != null && String(password).length > 0) {
    if (String(password).length < 8) {
      throw Object.assign(
        new Error("Password must be at least 8 characters"),
        { status: 400 },
      );
    }
    const passwordHash = await bcrypt.hash(String(password), 12);
    await updateStaffAdminPassword(numericId, passwordHash);
  }

  const normalizedPerms = normalizePermissions(permissions);
  const updated = await updateStaffAdminUser(numericId, {
    email: normalizedEmail,
    username: normalizedEmail,
    permissions: normalizedPerms,
  });

  if (!updated) {
    throw Object.assign(new Error("Staff user not found"), { status: 404 });
  }

  return toStaffPublic(updated);
}

export async function removeStaffUser(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    throw Object.assign(new Error("Invalid user id"), { status: 400 });
  }

  const deleted = await deleteStaffAdminUser(numericId);
  if (!deleted) {
    throw Object.assign(new Error("Staff user not found"), { status: 404 });
  }

  return { id: deleted.id };
}
