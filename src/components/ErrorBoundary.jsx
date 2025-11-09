import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Suppress WebSocket errors
    if (error?.message?.includes('WebSocket') || error?.toString().includes('WebSocket')) {
      console.warn('WebSocket error suppressed:', error);
      return;
    }

    console.error("Error caught by boundary:", error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Don't render error UI for WebSocket errors
      if (this.state.error?.message?.includes('WebSocket') || 
          this.state.error?.toString().includes('WebSocket')) {
        return this.props.children;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
          <Card className="max-w-2xl w-full bg-slate-800/50 border-slate-700">
            <CardHeader className="border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-rose-500/10 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <CardTitle className="text-white">Something Went Wrong</CardTitle>
                  <p className="text-sm text-slate-400 mt-1">
                    The application encountered an unexpected error
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-300 font-mono">
                  {this.state.error?.message || 'Unknown error occurred'}
                </p>
              </div>

              <div className="flex gap-3">
                <Button 
                  onClick={this.handleReset} 
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Application
                </Button>
                <Button 
                  onClick={this.handleHome} 
                  variant="outline"
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
                </Button>
              </div>

              <p className="text-xs text-slate-500 text-center">
                If the problem persists, please contact support
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;