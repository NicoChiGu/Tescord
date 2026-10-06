import React from "react";
import { TitleBar } from "./components/TitleBar.js";
import { AuthModal } from "./components/auth/AuthModal.js";
import { GlobalToastContainer } from "./components/ui/dialog/GlobalToastContainer.js";
import { installFetchInterceptor } from "./services/apiClient.js";
import { useAuthStore } from "./stores/useAuthStore.js";

installFetchInterceptor();

export const AuthWindowApp: React.FC = () => {
  const initAuth = useAuthStore((state) => state.initAuth);
  React.useEffect(() => {
    void initAuth();
  }, [initAuth]);
  return (
    <div className="flex flex-col h-screen w-screen bg-discord-chat overflow-hidden select-none">
      <TitleBar forceMode="auth" />
      <div className="flex-1 overflow-hidden relative">
        <AuthModal />
      </div>
      <GlobalToastContainer />
    </div>
  );
};
