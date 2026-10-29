import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { GoogleOAuthProvider } from "@react-oauth/google"
import "./index.css"

import App from "./App.tsx"
import AdminDashboard from "./AdminDashboard.tsx"

const isAdminPage = window.location.pathname === "/admin"
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ""

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAdminPage ? (
      <AdminDashboard />
    ) : (
      <GoogleOAuthProvider clientId={googleClientId}>
        <App />
      </GoogleOAuthProvider>
    )}
  </StrictMode>,
)
