import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  WifiOff,
  AlertTriangle
} from "lucide-react";
import { useOfflineMode } from "@/hooks/useOfflineMode";

export default function OfflineSyncIndicator() {
  const {
    isOnline,
    pendingSyncCount,
    failedSyncCount,
    isSyncing,
    syncStatus,
    lastSyncTime,
    syncOfflineData,
    failedActions,
    retryFailedAction,
    clearFailedActions
  } = useOfflineMode();

  // Don't show if online and nothing pending
  if (isOnline && !isSyncing && pendingSyncCount === 0 && failedSyncCount === 0) {
    return null;
  }

  const handleManualSync = async () => {
    await syncOfflineData(true);
  };

  return (
    <Card className={`${
      !isOnline ? 'bg-amber-500/10 border-amber-500/20' :
      failedSyncCount > 0 ? 'bg-rose-500/10 border-rose-500/20' :
      isSyncing ? 'bg-sky-500/10 border-sky-500/20' :
      'bg-emerald-500/10 border-emerald-500/20'
    }`}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {!isOnline ? (
                <WifiOff className="w-5 h-5 text-amber-400" />
              ) : isSyncing ? (
                <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
              ) : failedSyncCount > 0 ? (
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              )}
              <div>
                <h3 className={`font-semibold ${
                  !isOnline ? 'text-amber-400' :
                  failedSyncCount > 0 ? 'text-rose-400' :
                  isSyncing ? 'text-sky-400' :
                  'text-emerald-400'
                }`}>
                  {!isOnline ? 'Offline Mode' :
                   isSyncing ? 'Syncing Data...' :
                   failedSyncCount > 0 ? 'Sync Issues' :
                   'All Data Synced'}
                </h3>
                <p className="text-sm text-slate-300 mt-0.5">
                  {!isOnline ? 'Working offline - data will sync when online' :
                   isSyncing ? `Syncing ${syncStatus.inProgress} of ${syncStatus.total} actions` :
                   failedSyncCount > 0 ? `${failedSyncCount} action${failedSyncCount > 1 ? 's' : ''} failed to sync` :
                   lastSyncTime ? `Last sync: ${new Date(lastSyncTime).toLocaleTimeString()}` : 'Ready to sync'}
                </p>
              </div>
            </div>
            
            {isOnline && !isSyncing && (pendingSyncCount > 0 || failedSyncCount > 0) && (
              <Button
                size="sm"
                onClick={handleManualSync}
                className="bg-sky-600 hover:bg-sky-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Now
              </Button>
            )}
          </div>

          {/* Progress Bar for Syncing */}
          {isSyncing && syncStatus.total > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>{syncStatus.completed} completed</span>
                <span>{syncStatus.total} total</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div 
                  className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(syncStatus.completed / syncStatus.total) * 100}%` }}
                />
              </div>
              {syncStatus.failed > 0 && (
                <p className="text-xs text-rose-400 mt-1">
                  {syncStatus.failed} failed
                </p>
              )}
            </div>
          )}

          {/* Queue Status */}
          {!isSyncing && (pendingSyncCount > 0 || failedSyncCount > 0) && (
            <div className="flex gap-2">
              {pendingSyncCount > 0 && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                  <Clock className="w-3 h-3 mr-1" />
                  {pendingSyncCount} queued
                </Badge>
              )}
              {failedSyncCount > 0 && (
                <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {failedSyncCount} failed
                </Badge>
              )}
            </div>
          )}

          {/* Failed Actions List */}
          {failedActions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400 font-medium">Failed Actions</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearFailedActions}
                  className="h-6 text-xs text-slate-400 hover:text-white"
                >
                  Clear All
                </Button>
              </div>
              
              {failedActions.slice(0, 3).map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-700"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-xs ${
                        action.priority === "critical" ? "border-rose-500 text-rose-400" :
                        action.priority === "high" ? "border-orange-500 text-orange-400" :
                        "border-slate-500 text-slate-400"
                      }`}>
                        {action.priority}
                      </Badge>
                      <span className="text-xs text-white truncate">
                        {action.type || "Unknown"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {action.error || "Failed to sync"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => retryFailedAction(action.id)}
                    className="h-7 px-2 text-xs text-sky-400 hover:text-sky-300"
                  >
                    Retry
                  </Button>
                </div>
              ))}
              
              {failedActions.length > 3 && (
                <p className="text-xs text-slate-500 text-center">
                  +{failedActions.length - 3} more failed action{failedActions.length - 3 > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}