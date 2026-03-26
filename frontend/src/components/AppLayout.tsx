import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { LayoutList, PlusCircle, Palette, Plug, CheckCircle2, Settings, Menu, X } from "lucide-react";

function SidebarSection({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
      {label}
    </p>
  );
}

function SidebarNavItem({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150"
      activeClassName="bg-secondary text-secondary-foreground font-semibold"
    >
      <span className="h-4 w-4 shrink-0 flex items-center justify-center">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge}
    </NavLink>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

function SidebarContent({
  hubspotConnected,
  cloudUserEmail,
  onSignOut,
  onClose,
  showCloseButton = false,
}: {
  hubspotConnected: boolean;
  cloudUserEmail: string | null;
  onSignOut: () => void;
  onClose?: () => void;
  showCloseButton?: boolean;
}) {
  return (
    <>
      <div
        className="flex items-center justify-between gap-2.5 px-5 py-[18px] shrink-0"
        style={{ background: "linear-gradient(135deg, #683c19, #3f240f)" }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/mark-logo.png" alt="Mark" className="h-7 w-7" />
          <div className="leading-none">
            <p className="text-[15px] font-display font-bold text-white tracking-tight">Mark</p>
            <p className="text-[10px] text-white/50 font-mono-display mt-0.5">AI Campaign Agent</p>
          </div>
        </div>
        {showCloseButton ? (
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1 rounded"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 px-3 pb-3 overflow-y-auto">
        <SidebarSection label="Workspace" />
        <SidebarNavItem to="/campaigns" icon={<LayoutList className="h-4 w-4" />} label="Campaigns" />
        <SidebarNavItem to="/create" icon={<PlusCircle className="h-4 w-4" />} label="Create" />

        <SidebarSection label="Settings" />
        <SidebarNavItem to="/brand" icon={<Palette className="h-4 w-4" />} label="Brand" />
        <SidebarNavItem to="/settings" icon={<Settings className="h-4 w-4" />} label="Settings" />
        <SidebarNavItem
          to="/"
          icon={<Plug className="h-4 w-4" />}
          label="Integrations"
          badge={
            hubspotConnected
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              : <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
          }
        />
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-3 py-2.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${hubspotConnected ? "bg-emerald-500" : "bg-sidebar-foreground/20"}`} />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-sidebar-foreground truncate">HubSpot CRM</p>
            <p className="text-[10px] text-sidebar-foreground/50">{hubspotConnected ? "Connected" : "Not connected"}</p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-1">
          <p className="text-[10px] text-sidebar-foreground/40 truncate">
            {cloudUserEmail ? `Cloud: ${cloudUserEmail}` : "Cloud signed in"}
          </p>
          <button
            onClick={onSignOut}
            className="text-[10px] px-2 py-1 rounded border border-sidebar-border text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            Sign out
          </button>
        </div>
        <p className="mt-2 px-1 text-[10px] text-sidebar-foreground/30 font-mono-display">Mark AI v1.0</p>
      </div>
    </>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const hubspotConnected = useHubSpotStore((s) => s.connected);
  const cloudSignOut = useCloudAuthStore((s) => s.signOut);
  const cloudUser = useCloudAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px]"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar popout */}
      <div
        ref={sidebarRef}
        className={`fixed top-0 left-0 z-40 h-screen flex flex-col bg-sidebar border-r border-sidebar-border shadow-xl
          transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ width: "14rem" }}
      >
        <SidebarContent
          hubspotConnected={hubspotConnected}
          cloudUserEmail={cloudUser?.email ?? null}
          showCloseButton
          onClose={() => setOpen(false)}
          onSignOut={() => { void cloudSignOut(); }}
        />
      </div>

      {/* Menu trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-50 flex items-center justify-center h-9 w-9 rounded-md bg-card border border-border shadow-sm text-foreground hover:bg-accent transition-colors"
        aria-label="Open menu"
        style={{ display: open ? "none" : undefined }}
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10 pt-16">{children}</div>
      </main>
    </div>
  );
}
