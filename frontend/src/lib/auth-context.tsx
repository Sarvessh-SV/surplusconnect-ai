"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getStoredToken, setStoredToken } from "./api";
import type { HealthResponse, UserPublic, UserRole } from "./types";

interface AuthContextValue {
  user: UserPublic | null;
  loading: boolean;
  health: HealthResponse | null;
  login: (
    email: string,
    password: string,
    expectedRole?: UserRole
  ) => Promise<UserPublic>;
  register: (payload: Record<string, unknown>) => Promise<UserPublic>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ROLE_DASHBOARD_PATH: Record<UserRole, string> = {
  business: "/dashboard/business",
  organization: "/dashboard/organization",
  delivery_partner: "/dashboard/delivery",
  sponsor: "/dashboard/sponsor",
  admin: "/dashboard/admin",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    try {
      const h = await api.health();
      setHealth(h);
    } catch {
      // Backend might be booting; UI displays connection warning gracefully
    }
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string, expectedRole?: UserRole) => {
      const res = await api.login(email, password, expectedRole);
      setStoredToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const register = useCallback(async (payload: Record<string, unknown>) => {
    const res = await api.register(payload);
    setStoredToken(res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, health, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

