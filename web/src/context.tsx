import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import { APP_COLORS } from "./components/AppBadge";
import type { AccountInfo, CreditPack, CredentialTypeDef, Meta, NodeDefinition, PaymentInfo, PlanDef, SubscriptionRequest, User } from "./types";

/* ---------- auth ---------- */
interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<{ user: User }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback((token: string, next: User) => {
    tokenStore.set(token);
    setUser(next);
  }, []);

  const signOut = useCallback(() => {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    tokenStore.clear();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, signIn, signOut, updateUser: setUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/* ---------- platform metadata (node + credential catalog) ---------- */
interface MetaState {
  meta: Meta;
  nodeDef: (type: string) => NodeDefinition | undefined;
  credType: (key: string) => CredentialTypeDef | undefined;
  appColor: (app: string) => string;
}

const MetaContext = createContext<MetaState>(null as unknown as MetaState);

// Credential-only apps have no node to take a color from.
const fallbackColors: Record<string, string> = APP_COLORS;

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Meta>("/meta")
      .then(setMeta)
      .catch((e: Error) => setError(e.message));
  }, []);

  const value = useMemo<MetaState | null>(() => {
    if (!meta) return null;
    const nodes = new Map(meta.nodes.map((n) => [n.type, n]));
    const creds = new Map(meta.credentialTypes.map((c) => [c.key, c]));
    const colors = new Map<string, string>();
    for (const node of meta.nodes) if (!colors.has(node.app)) colors.set(node.app, node.color);
    return {
      meta,
      nodeDef: (type) => nodes.get(type),
      credType: (key) => creds.get(key),
      appColor: (app) => colors.get(app) ?? fallbackColors[app] ?? "#64748b",
    };
  }, [meta]);

  if (error) return <div className="empty">تعذّر الاتصال بالسيرفر: {error}</div>;
  if (!value) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }
  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);

/* ---------- plan & credits ---------- */
interface AccountState {
  account: AccountInfo | null;
  plans: PlanDef[];
  packs: CreditPack[];
  payment: PaymentInfo | null;
  requests: SubscriptionRequest[];
  refresh: () => void;
}

const AccountContext = createContext<AccountState>({ account: null, plans: [], packs: [], payment: null, requests: [], refresh: () => {} });

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const [state, setState] = useState<Omit<AccountState, "refresh">>({ account: null, plans: [], packs: [], payment: null, requests: [] });
  const refresh = useCallback(() => {
    if (!tokenStore.get()) return;
    api<{ account: AccountInfo; plans: PlanDef[]; packs: CreditPack[]; payment: PaymentInfo; requests: SubscriptionRequest[] }>("/billing")
      .then((res) => setState({ account: res.account, plans: res.plans, packs: res.packs, payment: res.payment, requests: res.requests }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!signedIn) {
      setState({ account: null, plans: [], packs: [], payment: null, requests: [] });
      return;
    }
    refresh();
    // Credits move as scenarios run: keep the counter live while the page is open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, signedIn]);
  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
