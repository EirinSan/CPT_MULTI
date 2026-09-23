import type { PublicUser } from "@cpt/shared";
import { create } from "zustand";

const STORAGE_KEY = "cpt.auth";

interface Persisted {
  token: string;
  user: PublicUser;
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function save(value: Persisted | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: session-only login */
  }
}

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  login: (token: string, user: PublicUser) => void;
  setUser: (user: PublicUser) => void;
  logout: () => void;
}

const initial = load();

export const useAuth = create<AuthState>((set, get) => ({
  token: initial?.token ?? null,
  user: initial?.user ?? null,
  login: (token, user) => {
    save({ token, user });
    set({ token, user });
  },
  setUser: (user) => {
    const { token } = get();
    if (token) save({ token, user });
    set({ user });
  },
  logout: () => {
    save(null);
    set({ token: null, user: null });
  },
}));
