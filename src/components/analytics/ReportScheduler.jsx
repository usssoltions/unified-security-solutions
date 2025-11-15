import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Plus, Loader2, Calendar, Send, Mail, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ReportScheduler({ onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    report_type: "daily_activity",
    frequency: "daily",
    send_time: "08:00",
    send_day: "",
    is_comparative: false,
    compare_with: "previous_day",
    status: "active"
  });
  const [emailRecipients, setEmailRecipients] = useState([""]);
  const [whatsappRecipients, setWhatsappRecipients] = useState([{ name: "", phone: "" }]);
  const [selectedSites, setSelectedSites] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => await base44.entities.Site.list(),
    initialData: []
  });

  const { data: schedules } = useQuery({
    queryKey: ["reportSchedules"],
    queryFn: async () => await base44.entities.ReportSchedule.list(),
    initialData: []
  });

  const reportTypes = [
    { value: "daily_activity", label: "Daily Activity Report" },
    { value: "incidents", label: "Incident Summary" },
    { value: "maintenance", label: "Maintenance Report" },
    { value: "patrol_coverage", label: "Patrol Coverage" },
    { value: "stay_awake", label: "Stay Awake Compliance" },
    { value: "shift_attendance", label: "Shift Attendance" },
    { value: "guard_performance", label: "Guard Performance" },
    { value: "checklist_completion", label: "Checklist Completion" },
    { value: "asset_register", label: "Asset Register" }
  ];

  const frequencies = [
    { value: "realtime", label: "Real-time (as submitted)" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" }
  ];

  const comparisons = [
    { value: "previous_day", label: "Previous Day" },
    { value: "previous_week", label: "Previous Week" },
    { value: "previous_month", label: "Previous Month" },
    { value: "previous_year", label: "Previous Year" },
    { value: "same_period_last_year", label: "Same Period Last Year" }
  ];

  const addEmailRecipient = () => {
    setEmailRecipients([...emailRecipients, ""]);
  };

  const updateEmailRecipient = (index, value) => {
    const newRecipients = [...emailRecipients];
    newRecipients[index] = value;
    setEmailRecipients(newRecipients);
  };

  const removeEmailRecipient = (index) => {
    setEmailRecipients(emailRecipients.filter((_, i) => i !== index));
  };

  const addWhatsAppRecipient = () => {
    setWhatsappRecipients([...whatsappRecipients, { name: "", phone: "" }]);
  };

  const updateWhatsAppRecipient = (index, field, value) => {
    const newRecipients = [...whatsappRecipients];
    newRecipients[index][field] = value;
    setWhatsappRecipients(newRecipients);
  };

  const removeWhatsAppRecipient = (index) => {
    setWhatsappRecipients(whatsappRecipients.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    const validEmailRecipients = emailRecipients.filter(r => r.trim().length > 0);
    const validWhatsAppRecipients = whatsappRecipients.filter(r => r.name.trim() && r.phone.trim());
    
    if (!formData.name || (validEmailRecipients.length === 0 && validWhatsAppRecipients.length === 0)) {
      alert("Please provide a schedule name and at least one recipient");
      return;
    }

    setSubmitting(true);

    try {
      await base44.entities.ReportSchedule.create({
        ...formData,
        email_recipients: validEmailRecipients,
        whatsapp_recipients: validWhatsAppRecipients,
        sites: selectedSites
      });

      alert("Report schedule created successfully! Reports will be sent automatically.");
      onClose();
    } catch (error) {
      alert("Failed to create report schedule: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-3xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white text-xl">Schedule Automated Report</CardTitle>
                  <p className="text-sm text-slate-400 mt-1">Send reports via Email & WhatsApp automatically</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {schedules.length > 0 && (
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                <h3 className="text-sm font-semibold text-white mb-3">Active Schedules</h3>
                <div className="space-y-2">
                  {schedules.slice(0, 3).map((schedule) => (
                    <div key={schedule.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{schedule.name}</span>
                      <div className="flex gap-2">
                        {schedule.email_recipients?.length > 0 && (
                          <Badge variant="outline" className="border-sky-500 text-sky-400">
                            <Mail className="w-3 h-3 mr-1" />
                            {schedule.email_recipients.length}
                          </Badge>
                        )}
                        {schedule.whatsapp_recipients?.length > 0 && (
                          <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                            <MessageSquare className="w-3 h-3 mr-1" />
                            {schedule.whatsapp_recipients.length}
                          </Badge>
                        )}
                        <Badge className={schedule.status === "active" ? "bg-emerald-500" : "bg-slate-500"}>
                          {schedule.frequency}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Schedule Name <span className="text-rose-400">*</span>
              </label>
              <Input
                placeholder="e.g., Daily Morning Report"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Report Type</label>
                <Select
                  value={formData.report_type}
                  onValueChange={(value) => setFormData({ ...formData, report_type: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reportTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Frequency</label>
                <Select
                  value={formData.frequency}
                  onValueChange={(value) => setFormData({ ...formData, frequency: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {frequencies.map((freq) => (
                      <SelectItem key={freq.value} value={freq.value}>
                        {freq.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.frequency !== "realtime" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Send Time</label>
                  <Input
                    type="time"
                    value={formData.send_time}
                    onChange={(e) => setFormData({ ...formData, send_time: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                {(formData.frequency === "weekly" || formData.frequency === "monthly") && (
                  <div>
                    <label className="text-sm text-slate-300 font-medium block mb-2">
                      {formData.frequency === "weekly" ? "Day of Week" : "Day of Month"}
                    </label>
                    <Input
                      placeholder={formData.frequency === "weekly" ? "e.g., Monday" : "e.g., 1"}
                      value={formData.send_day}
                      onChange={(e) => setFormData({ ...formData, send_day: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 text-white cursor-pointer mb-3">
                <Checkbox
                  checked={formData.is_comparative}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_comparative: checked })}
                />
                <span className="text-sm font-medium">Enable Comparative Analysis</span>
              </label>
              {formData.is_comparative && (
                <Select
                  value={formData.compare_with}
                  onValueChange={(value) => setFormData({ ...formData, compare_with: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Compare with..." />
                  </SelectTrigger>
                  <SelectContent>
                    {comparisons.map((comp) => (
                      <SelectItem key={comp.value} value={comp.value}>
                        {comp.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Sites to Include</label>
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-900/50 rounded-lg max-h-48 overflow-y-auto">
                {sites.map((site) => (
                  <label key={site.id} className="flex items-center gap-2 text-white cursor-pointer">
                    <Checkbox
                      checked={selectedSites.includes(site.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedSites([...selectedSites, site.id]);
                        } else {
                          setSelectedSites(selectedSites.filter(s => s !== site.id));
                        }
                      }}
                    />
                    <span className="text-sm">{site.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <Tabs defaultValue="email" className="w-full">
              <TabsList className="bg-slate-900 w-full">
                <TabsTrigger value="email" className="flex-1">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Recipients
                </TabsTrigger>
                <TabsTrigger value="whatsapp" className="flex-1">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  WhatsApp Recipients
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="email" className="space-y-2 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-slate-300 font-medium">Email Addresses</label>
                  <Button size="sm" onClick={addEmailRecipient} variant="outline" className="border-slate-600">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Email
                  </Button>
                </div>
                {emailRecipients.map((email, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={email}
                      onChange={(e) => updateEmailRecipient(index, e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                    {emailRecipients.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeEmailRecipient(index)}
                        className="text-slate-400"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="whatsapp" className="space-y-2 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-slate-300 font-medium">WhatsApp Contacts</label>
                  <Button size="sm" onClick={addWhatsAppRecipient} variant="outline" className="border-slate-600">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Contact
                  </Button>
                </div>
                {whatsappRecipients.map((contact, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Name"
                      value={contact.name}
                      onChange={(e) => updateWhatsAppRecipient(index, "name", e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                    <Input
                      placeholder="+27123456789"
                      value={contact.phone}
                      onChange={(e) => updateWhatsAppRecipient(index, "phone", e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                    {whatsappRecipients.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeWhatsAppRecipient(index)}
                        className="text-slate-400"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-slate-500 mt-2">
                  Note: Phone numbers must include country code (e.g., +27 for South Africa)
                </p>
              </TabsContent>
            </Tabs>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-purple-500 to-purple-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Create Schedule
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}