import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export default function ComparativeAnalytics({ incidents, shifts, checklists }) {
  const [compareWith, setCompareWith] = useState("previous_month");
  const [metric, setMetric] = useState("incidents");

  const generateComparisonData = () => {
    // Mock comparison data - in production, this would calculate from actual historical data
    const currentPeriod = {
      incidents: incidents.length,
      shifts: shifts.length,
      checklists: checklists.length,
      avgResponseTime: 12 // minutes
    };

    const previousPeriod = {
      incidents: Math.floor(incidents.length * 0.85),
      shifts: Math.floor(shifts.length * 0.92),
      checklists: Math.floor(checklists.length * 0.88),
      avgResponseTime: 15
    };

    return { currentPeriod, previousPeriod };
  };

  const { currentPeriod, previousPeriod } = generateComparisonData();

  const calculateChange = (current, previous) => {
    const change = ((current - previous) / previous * 100).toFixed(1);
    return {
      value: Math.abs(change),
      isPositive: change > 0,
      isNeutral: change === 0
    };
  };

  const comparisonMetrics = [
    {
      label: "Total Incidents",
      current: currentPeriod.incidents,
      previous: previousPeriod.incidents,
      betterWhenLower: true
    },
    {
      label: "Shifts Completed",
      current: currentPeriod.shifts,
      previous: previousPeriod.shifts,
      betterWhenLower: false
    },
    {
      label: "Checklists Done",
      current: currentPeriod.checklists,
      previous: previousPeriod.checklists,
      betterWhenLower: false
    },
    {
      label: "Avg Response Time",
      current: currentPeriod.avgResponseTime,
      previous: previousPeriod.avgResponseTime,
      betterWhenLower: true,
      suffix: "min"
    }
  ];

  const chartData = [
    { name: 'Previous', incidents: previousPeriod.incidents, shifts: previousPeriod.shifts },
    { name: 'Current', incidents: currentPeriod.incidents, shifts: currentPeriod.shifts }
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Comparative Analysis</CardTitle>
            <Select value={compareWith} onValueChange={setCompareWith}>
              <SelectTrigger className="w-48 bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous_day">vs Previous Day</SelectItem>
                <SelectItem value="previous_week">vs Previous Week</SelectItem>
                <SelectItem value="previous_month">vs Previous Month</SelectItem>
                <SelectItem value="previous_year">vs Previous Year</SelectItem>
                <SelectItem value="same_period_last_year">vs Same Period Last Year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {comparisonMetrics.map((metric, index) => {
              const change = calculateChange(metric.current, metric.previous);
              const isImprovement = metric.betterWhenLower 
                ? !change.isPositive 
                : change.isPositive;

              return (
                <div key={index} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <p className="text-sm text-slate-400 mb-2">{metric.label}</p>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold text-white">
                      {metric.current}{metric.suffix || ""}
                    </span>
                    <span className="text-sm text-slate-500">
                      from {metric.previous}{metric.suffix || ""}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 text-sm font-semibold ${
                    change.isNeutral ? 'text-slate-400' :
                    isImprovement ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {change.isNeutral ? (
                      <Minus className="w-4 h-4" />
                    ) : change.isPositive ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4" />
                    )}
                    {change.value}% {compareWith.replace(/_/g, ' ')}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Period Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
              <Bar dataKey="incidents" fill="#ef4444" name="Incidents" />
              <Bar dataKey="shifts" fill="#10b981" name="Shifts" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}