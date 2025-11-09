import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    
    // Suppress WebSocket errors
    if (error?.message?.includes('WebSocket')) {
      console.warn('WebSocket error suppressed:', error.message);
      return;
    }
  }

  render() {
    if (this.state.hasError) {
      // Don't show error UI for WebSocket issues
      if (this.state.error?.message?.includes('WebSocket')) {
        return this.props.children;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <Card className="max-w-md bg-slate-800 border-slate-700">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="w-16 h-16 text-rose-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
              <p className="text-slate-400 mb-6">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <Button
                onClick={() => window.location.reload()}
                className="bg-sky-600 hover:bg-sky-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload App
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;