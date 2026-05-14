import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, FlaskConical, HelpCircle, Menu, LogIn, Wallet } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import logo from "@/assets/logo.png";

export function PublicHeader() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const navItems = [
    { path: "/api-docs", label: "API Docs", icon: FileText },
    { path: "/api-test", label: "API Test", icon: FlaskConical },
    { path: "/faq", label: "FAQ", icon: HelpCircle },
    { path: "/costs", label: "Costs", icon: Wallet },
    { path: "/terms", label: "Terms" },
  ];

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/login" className="flex items-center">
            <img src={logo} alt="opentape" className="h-8" />
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
          <Link to="/login">
            <Button variant="outline" size="sm" className="hidden sm:flex">
              <LogIn className="h-4 w-4 mr-2" />
              Login
            </Button>
          </Link>
          
          {/* Mobile Menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="sm">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] bg-card">
              <nav className="flex flex-col gap-2 mt-6">
                {navItems.map((item) => (
                  <Link key={item.path} to={item.path} onClick={() => setOpen(false)}>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start",
                        location.pathname === item.path && "bg-muted"
                      )}
                    >
                      {item.icon && <item.icon className="h-4 w-4 mr-2" />}
                      {item.label}
                    </Button>
                  </Link>
                ))}
                <div className="border-t my-2" />
                <Link to="/login" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full justify-start">
                    <LogIn className="h-4 w-4 mr-2" />
                    Login
                  </Button>
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
