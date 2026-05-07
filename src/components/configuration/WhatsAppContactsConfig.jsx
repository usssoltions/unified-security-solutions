import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { saveWhatsAppContacts } from "@/lib/whatsapp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, MessageCircle, Save, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

export default function WhatsAppContactsConfig() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newRole, setNewRole] = useState("admin");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadContacts(); }, []);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const records = await base44.entities.WhatsAppContact.filter({ active: true });
      setContacts(records);
      // Also cache locally for offline fallback
      saveWhatsAppContacts(records.map(r => ({ name: r.name, number: r.number })));
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newNumber.trim()) return;
    setSaving(true);
    try {
      const created = await base44.entities.WhatsAppContact.create({
        name: newName.trim(),
        number: newNumber.trim(),
        role: newRole,
        active: true,
      });
      const updated = [...contacts, created];
      setContacts(updated);
      saveWhatsAppContacts(updated.map(r => ({ name: r.name, number: r.number })));
      setNewName("");
      setNewNumber("");
      setNewRole("admin");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert("Failed to add contact: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (contact) => {
    try {
      await base44.entities.WhatsAppContact.update(contact.id, { active: false });
      const updated = contacts.filter(c => c.id !== contact.id);
      setContacts(updated);
      saveWhatsAppContacts(updated.map(r => ({ name: r.name, number: r.number })));
    } catch (e) {
      alert("Failed to remove contact");
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-white">WhatsApp Admin Contacts</CardTitle>
              <p className="text-sm text-slate-400 mt-0.5">
                Stored in the database — available on all devices. These numbers receive all WhatsApp alerts.
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={loadContacts} className="text-slate-400">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <Input
            placeholder="Name (e.g. Head of Security)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white sm:col-span-1"
          />
          <Input
            placeholder="+27831234567 or 0831234567"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white sm:col-span-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="supervisor">Supervisor</SelectItem>
              <SelectItem value="management">Management</SelectItem>
              <SelectItem value="dispatcher">Dispatcher</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            Add
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading contacts...</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
            No contacts added yet. Add at least one admin WhatsApp number above.
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{c.name}</p>
                    <p className="text-slate-400 text-xs">{c.number} · <span className="capitalize">{c.role}</span></p>
                  </div>
                </div>
                <button onClick={() => handleRemove(c)} className="text-rose-400 hover:text-rose-300 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Contact saved to database
          </div>
        )}

        <p className="text-xs text-slate-500 text-center">
          Contacts are stored in the database and available across all devices automatically.
        </p>
      </CardContent>
    </Card>
  );
}