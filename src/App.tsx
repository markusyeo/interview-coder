import SubscribedApp from "./_pages/SubscribedApp";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./components/ui/toast";
import { ToastContext } from "./contexts/toast";

// Create a React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// Root component that provides the QueryClient
function App() {
  const [toastState, setToastState] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant: "neutral" | "success" | "error";
  }>({
    open: false,
    title: "",
    description: "",
    variant: "neutral" as const,
  });
  const [currentLanguage, setCurrentLanguage] = useState<string>("python");
  const [isInitialized, setIsInitialized] = useState(false);

  // Helper function to safely update language
  const updateLanguage = useCallback((newLanguage: string) => {
    setCurrentLanguage(newLanguage);
    window.__LANGUAGE__ = newLanguage;
  }, []);

  // Helper function to mark initialization complete
  const markInitialized = useCallback(() => {
    setIsInitialized(true);
    window.__IS_INITIALIZED__ = true;
  }, []);

  // Show toast method
  const showToast = useCallback(
    (
      title: string,
      description: string,
      variant: "neutral" | "success" | "error"
    ) => {
      setToastState({
        open: true,
        title,
        description,
        variant,
      });
    },
    []
  );

  // Handle initialization
  useEffect(() => {
    const initialize = async () => {
      updateLanguage("python");
      markInitialized();
    };

    initialize();
  }, [updateLanguage, markInitialized, showToast, isInitialized]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ToastContext.Provider value={{ showToast }}>
          <AppContent isInitialized={isInitialized} />
          <Toast
            open={toastState.open}
            onOpenChange={(open) =>
              setToastState((prev) => ({ ...prev, open }))
            }
            variant={toastState.variant}
            duration={1500}
          >
            <ToastTitle>{toastState.title}</ToastTitle>
            <ToastDescription>{toastState.description}</ToastDescription>
          </Toast>
          <ToastViewport />
        </ToastContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function AppContent({ isInitialized }: { isInitialized: boolean }) {
  const [loading, setLoading] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState<string>("python");

  // Show loading state while checking initialization
  if (loading || !isInitialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
          <p className="text-white/60 text-sm">
            {loading
              ? "Loading..."
              : !isInitialized
              ? "Initializing...If you see this screen for more than 10 seconds, please quit and restart the app."
              : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <SubscribedApp
      currentLanguage={currentLanguage}
      setLanguage={setCurrentLanguage}
    />
  );
}

export default App;
