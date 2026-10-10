import type { User } from './auth.js';

export interface ProfileUpdateInput {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface ProfileUpdateResult {
  user: User;
  requiresLogin: boolean;
}
