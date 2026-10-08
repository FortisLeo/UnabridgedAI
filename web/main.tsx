import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { AdminApp } from "./features/admin/AdminApp.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(location.pathname.startsWith("/admin") ? <AdminApp /> : <App />);
