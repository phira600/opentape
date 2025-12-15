import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { TrendingUp, LogOut, FileText, FlaskConical, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

export function Header() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Dashboard" },
    { path: "/api-docs", label: "API Docs", icon: FileText },
    { path: "/api-test", label: "API Test", icon: FlaskConical },
    { path: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">Trade Aggregator</h1>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.path} to={item.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    location.pathname === item.path && "bg-muted"
                  )}
                >
                  {item.icon && <item.icon className="h-4 w-4 mr-1" />}
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}
