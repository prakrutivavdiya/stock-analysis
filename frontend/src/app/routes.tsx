import { createBrowserRouter, Navigate } from "react-router";
import Login from "./pages/Login";
import AppShell from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import Charts from "./pages/Charts";
import KPIBuilder from "./pages/KPIBuilder";
import KPIGuide from "./pages/KPIGuide";
import Orders from "./pages/Orders";
import AuditLog from "./pages/AuditLog";
import Settings from "./pages/Settings";
import Alerts from "./pages/Alerts";
import NotFound from "./pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/",
    Component: AppShell,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: "dashboard",
        Component: Dashboard,
      },
      {
        path: "charts",
        Component: Charts,
      },
      {
        path: "charts/:symbol",
        Component: Charts,
      },
      {
        path: "kpis",
        Component: KPIBuilder,
      },
      {
        path: "kpis/guide",
        Component: KPIGuide,
      },
      {
        path: "orders",
        Component: Orders,
      },
      {
        path: "audit",
        Component: AuditLog,
      },
      {
        path: "settings",
        Component: Settings,
      },
      {
        path: "alerts",
        Component: Alerts,
      },
      {
        path: "*",
        Component: NotFound,
      },
    ],
  },
]);
