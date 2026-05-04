import React, { useState, useEffect } from "react";
import { getWhatsAppContacts, saveWhatsAppContacts } from "@/lib/whatsapp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, MessageCircle, Save, CheckCircle2 } from "lucide-react";

export default function WhatsAppContactsConfig() {
  const [contacts, setContacts] = useState([]);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setContacts(getWhatsAppContacts());
  }, []);

  const handleAdd = () => {
    if (!newName.trim() || !newNumber.trim()) return;
    const updated = [...contacts, { name: newName.trim(), number: newNumber.trim() }];
    setContacts(updated);
    setNewName("");
    setNewNumber("");
  };

  const handleRemove = (index) => {
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
  };

  const handleSave = () => {
    saveWhatsAppContacts(contacts);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-white">WhatsApp Admin Contacts</CardTitle>
            <p className="text-sm text-slate-400 mt-0.5">
              These numbers receive all WhatsApp alerts — panic, incidents, maintenance, dispatch, shift schedule.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new */}
        <div className="flex gap-2">
          <Input
            placeholder="Name (e.g. Head of Security)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white flex-1"
          />
          <Input
            placeholder="+27831234567 or 0831234567"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* List */}
        {contacts.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
            No contacts added yet. Add at least one admin WhatsApp number above.
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((c, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{c.name}</p>
                    <p className="text-slate-400 text-xs">{c.number}</p>
                  </div>
                </div>
                <button onClick={() => handleRemove(i)} className="text-rose-400 hover:text-rose-300 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={handleSave}
          className={`w-full ${saved ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700"}`}
        >
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Contacts
            </>
          )}
        </Button>

        <p className="text-xs text-slate-500 text-center">
          Contacts are saved locally on this device. Configure on any admin device used to manage the system.
        </p>
      </CardContent>
    </Card>
  );
}