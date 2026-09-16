import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { NetworkBackground } from "./components/NetworkBackground";
import { PublicLayout } from "./components/PublicLayout";
import { Spinner, ToastProvider } from "./components/ui";
import { AuthProvider, MetaProvider, useAuth } from "./context";
import { AuthPage } from "./pages/AuthPage";
import { Landing } from "./pages/Landing";

const Editor = lazy(() => import("./editor/Editor").then((m) => ({ default: m.Editor })));
const Credentials = lazy(() => import("./pages/Credentials").then((m) => ({ default: m.Credentials })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const DataStore = lazy(() => import("./pages/DataStore").then((m) => ({ default: m.DataStore })));
const Executions = lazy(() => import("./pages/Executions").then((m) => ({ default: m.Executions })));
const FormPage = lazy(() => import("./pages/FormPage").then((m) => ({ default: m.FormPage })));
const MediaLibrary = lazy(() => import("./pages/MediaLibrary").then((m) => ({ default: m.MediaLibrary })));
const Contact = lazy(() => import("./pages/public/Contact").then((m) => ({ default: m.Contact })));
const Features = lazy(() => import("./pages/public/Features").then((m) => ({ default: m.Features })));
const Integrations = lazy(() => import("./pages/public/Integrations").then((m) => ({ default: m.Integrations })));
const Pricing = lazy(() => import("./pages/public/Pricing").then((m) => ({ default: m.Pricing })));
const PublicTemplates = lazy(() => import("./pages/public/PublicTemplates").then((m) => ({ default: m.PublicTemplates })));
const Templates = lazy(() => import("./pages/Templates").then((m) => ({ default: m.Templates })));

const PageLoading = () => (
  <div className="empty" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
    <Spinner size={26} />
  </div>
);

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
      <NetworkBackground />
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/features" element={<Features />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/templates" element={<PublicTemplates />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contact" element={<Contact />} />
            </Route>
            <Route path="/form/:path" element={<FormPage />} />
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
              <Route path="media" element={<MediaLibrary />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
