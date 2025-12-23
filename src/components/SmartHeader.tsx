import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/dashboard/Header";
import { PublicHeader } from "@/components/PublicHeader";

export function SmartHeader() {
  const { user, isLoading } = useAuth();

  // While loading, show public header (will switch if user is logged in)
  if (isLoading) {
    return <PublicHeader />;
  }

  return user ? <Header /> : <PublicHeader />;
}
