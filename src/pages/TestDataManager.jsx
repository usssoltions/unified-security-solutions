import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function TestDataManager() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const clearData = async () => {
    if (!confirm('Are you sure you want to clear ALL test data? This cannot be undone!')) {
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data } = await base44.functions.invoke('clearTestData', {});
      setResult(data);
    } catch (error) {
      setResult({ success: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role_type !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Alert className="bg-rose-900/30 border-rose-500/50 max-w-md">
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          <AlertDescription className="text-rose-200">
            Admin access required to manage test data
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-white">Test Data Manager</h1>

        <Card className="bg-rose-900/20 border-rose-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
              Clear All Test Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-rose-900/30 border-rose-500/50">
              <AlertDescription className="text-rose-200">
                ⚠️ This will permanently delete all incidents, maintenance requests, alarms, alerts, notifications, PTT messages, and call history. Active shifts will be kept.
              </AlertDescription>
            </Alert>

            <Button
              onClick={clearData}
              disabled={loading}
              className="w-full bg-rose-600 hover:bg-rose-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Clearing Data...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear All Test Data
                </>
              )}
            </Button>

            {result && (
              <div className={`p-4 rounded-lg ${result.success ? 'bg-emerald-900/20 border border-emerald-500/30' : 'bg-rose-900/20 border border-rose-500/30'}`}>
                {result.success ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <p className="text-white font-semibold">Data Cleared Successfully</p>
                    </div>
                    <div className="space-y-1 text-sm text-slate-300">
                      {Object.entries(result.details || {}).map(([key, value]) => (
                        <p key={key}>• {value}</p>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                      Cleared by: {result.clearedBy} at {new Date(result.timestamp).toLocaleString()}
                    </p>
                  </>
                ) : (
                  <p className="text-rose-200">Error: {result.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}