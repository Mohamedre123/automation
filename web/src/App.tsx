import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PublicLayout } from "./components/PublicLayout";
import { Spinner, ToastProvider } from "./components/ui";
import { AuthProvider, MetaProvider, useAuth } from "./context";
import { Editor } from "./editor/Editor";
import { AuthPage } from "./pages/AuthPage";
import { Credentials } from "./pages/Credentials";
import { Dashboard } from "./pages/Dashboard";
import { DataStore } from "./pages/DataStore";
import { Executions } from "./pages/Executions";
import { Landing } from "./pages/Landing";
import { Contact } from "./pages/public/Contact";
import { Features } from "./pages/public/Features";
import { Integrations } from "./pages/public/Integrations";
import { Pricing } from "./pages/public/Pricing";
import { PublicTemplates } from "./pages/public/PublicTemplates";
import { Templates } from "./pages/Templates";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="empty" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spinner size={28} />
      </div>
    );
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/features" element={<Features />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/templates" element={<PublicTemplates />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contact" element={<Contact />} />
            </Route>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route
              path="/app"
              element={
                <Protected>
                  <MetaProvider>
                    <Layout />
                  </MetaProvider>
                </Protected>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="workflows/:id" element={<Editor />} />
              <Route path="templates" element={<Templates />} />
              <Route path="credentials" element={<Credentials />} />
              <Route path="executions" element={<Executions />} />
              <Route path="datastore" element={<DataStore />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
