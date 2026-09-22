/**
 * medicalApi — the SOLE frontend data client for the MEDICAL module.
 *
 * Every medical page/component goes through the medicalAccess backend gateway
 * (base44.functions.invoke). Direct base44.entities.Patient/Appointment/...
 * access from the browser is FORBIDDEN — medical RLS is restricted to
 * platform administration, so direct client calls fail and would bypass the
 * gateway's role/ownership/privacy rules even if they did not.
 *
 * The gateway enforces, server-side:
 *   - role authorization (practice_admin / therapist / reception /
 *     employer_user / reseller / platform)
 *   - tenant isolation (never trusts client tenant ids)
 *   - record ownership (therapists act on own sessions/notes/reports;
 *     employers only on their own employees and RELEASED reports)
 *   - field-level privacy (employer users get sanitized projections)
 */
import { base44 } from "@/api/base44Client";

async function call(payload) {
  const res = await base44.functions.invoke("medicalAccess", payload);
  // SDK returns an Axios-style { data } envelope; tolerate both shapes.
  return res && typeof res === "object" && "data" in res ? res.data : res;
}

export const medicalApi = {
  getContext: () => call({ action: "get_context" }),

  // Patients
  listPatients: (filter) => call({ action: "list_patients", filter }),
  getPatient: (id) => call({ action: "get_patient", id }),
  createPatient: (data) => call({ action: "create_patient", data }),
  updatePatient: (id, changes) => call({ action: "update_patient", id, changes }),

  // Identity verification
  createVerification: (data) => call({ action: "create_verification", data }),
  listVerifications: (patientId) => call({ action: "list_verifications", patient_id: patientId }),

  // Private medical attachments (private storage, gateway-validated uploads,
  // short-lived signed URLs minted only after authorized access)
  uploadMedicalFile: (data) => call({ action: "upload_medical_file", data }),
  getMedicalFileUrl: (opts) => call({ action: "get_medical_file", ...opts }),
  listMedicalFiles: (patientId) => call({ action: "list_medical_files", patient_id: patientId }),
  revokeMedicalFile: (id) => call({ action: "revoke_medical_file", id }),

  // Employers
  listEmployers: (filter) => call({ action: "list_employers", filter }),
  getEmployer: (id) => call({ action: "get_employer", id }),
  createEmployer: (data) => call({ action: "create_employer", data }),
  updateEmployer: (id, changes) => call({ action: "update_employer", id, changes }),

  // Services
  listServices: (filter) => call({ action: "list_services", filter }),
  getService: (id) => call({ action: "get_service", id }),
  createService: (data) => call({ action: "create_service", data }),
  updateService: (id, changes) => call({ action: "update_service", id, changes }),

  // Appointments
  listAppointments: (filter) => call({ action: "list_appointments", filter }),
  createAppointment: (data) => call({ action: "create_appointment", data }),
  updateAppointment: (id, changes) => call({ action: "update_appointment", id, changes }),

  // Sessions
  listSessions: (filter) => call({ action: "list_sessions", filter }),
  getSession: (id) => call({ action: "get_session", id }),
  createSession: (data) => call({ action: "create_session", data }),
  updateSession: (id, changes) => call({ action: "update_session", id, changes }),

  // Clinical notes
  listNotes: (filter) => call({ action: "list_notes", filter }),
  createNote: (data) => call({ action: "create_note", data }),
  updateNote: (id, changes) => call({ action: "update_note", id, changes }),

  // Assessments
  listAssessments: (filter) => call({ action: "list_assessments", filter }),
  getAssessment: (id) => call({ action: "get_assessment", id }),
  saveAssessment: (data) => call({ action: "save_assessment", data }),

  // Assessment templates
  listTemplates: (filter) => call({ action: "list_templates", filter }),
  getTemplate: (id) => call({ action: "get_template", id }),
  createTemplate: (data) => call({ action: "create_template", data }),
  updateTemplate: (id, changes) => call({ action: "update_template", id, changes }),
  deleteTemplate: (id) => call({ action: "delete_template", id }),

  // Medical reports
  listReports: (filter) => call({ action: "list_reports", filter }),
  createReport: (data) => call({ action: "create_report", data }),
  updateReport: (id, changes, reason) => call({ action: "update_report", id, changes, reason }),
  shareReport: (id, recipientName) => call({ action: "share_report", id, recipient_name: recipientName }),

  // Consents
  listConsents: (patientId) => call({ action: "list_consents", patient_id: patientId }),
  createConsent: (data) => call({ action: "create_consent", data }),
};

export default medicalApi;