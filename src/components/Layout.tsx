import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Handshake, LayoutDashboard, ListTodo, Settings, UserPlus, Users } from "lucide-react";
import { getApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/contacts", label: "Contacts", icon: Users, end: false },
  { to: "/leads/new", label: "New Lead", icon: UserPlus, end: false },
  { to: "/tasks", label: "Tasks", icon: ListTodo, end: false },
  { to: "/transactions", label: "Transactions", icon: Handshake, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export default function Layout() {
  const api = getApi();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => api.currentUser() });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-card md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <Building2 className="h-6 w-6 text-primary" aria-hidden="true" />
          <span className="text-lg font-semibold">RealEstateCRM</span>
        </div>
        <nav aria-label="Main navigation" className="flex gap-1 px-2 pb-2 md:flex-col md:pb-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="hidden px-4 pb-4 md:block">
            <p className="text-xs text-muted-foreground">Signed in as {user.name}</p>
            {api.mode === "supabase" && (
              <button
                type="button"
                className="mt-1 text-xs text-primary hover:underline"
                onClick={() => void (api as import("@/lib/api/supabase").SupabaseApi).signOut()}
              >
                Sign out
              </button>
            )}
          </div>
        )}
      </aside>
      <div className="flex-1">
        {api.mode === "demo" && (
          <div
            role="status"
            className="border-b border-border bg-primary/10 px-4 py-2 text-sm text-primary"
          >
            Demo mode — data is in-memory and resets on reload. Connect a Supabase project
            (.env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) for real data.
          </div>
        )}
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
