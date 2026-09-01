/**
 * Module-aware role catalog.
 *
 * The platform serves two distinct industry verticals (Security and Medical),
 * each with its own role set. User Management and the invite/edit forms derive
 * their role options from here so a Medical practice only sees Medical roles
 * (Practice Admin / Therapist / Reception / Employer Portal User) and a Security
 * tenant only sees Security roles.
 *
 * `getRolesForTenant(customerType)` is the canonical accessor — pass the
 * current user's Customer `customer_type` ("medical" → Medical roles, anything
 * else → Security roles). A null/undefined customer type defaults to Security.
 */

export const SECURITY_ROLES = [
  { value: "admin", label: "Admin", color: "purple" },
  { value: "dispatcher", label: "Dispatcher / Supervisor", color: "sky" },
  { value: "guard", label: "Security Guard", color: "emerald" },
  { value: "client", label: "Client", color: "amber" },
  { value: "estate_manager", label: "Estate Manager", color: "teal" },
  { value: "resident", label: "Resident", color: "indigo" },
  { value: "vendor", label: "Vendor", color: "orange" },
];

export const MEDICAL_ROLES = [
  { value: "practice_admin", label: "Practice Administrator", color: "purple" },
  { value: "therapist", label: "Therapist", color: "emerald" },
  { value: "reception", label: "Reception", color: "sky" },
  { value: "employer_user", label: "Employer Portal User", color: "amber" },
];

export const ROLE_DESCRIPTIONS = {
  admin: { label: "Admin", text: "Full system access", color: "purple" },
  dispatcher: { label: "Dispatcher/Supervisor", text: "Control room, shifts, operations", color: "purple" },
  guard: { label: "Security Guard", text: "Field operations, clock in/out, incidents", color: "emerald" },
  client: { label: "Client", text: "View reports and incidents for their sites", color: "amber" },
  estate_manager: { label: "Estate Manager", text: "Manage residents, venues, vendors, levies", color: "teal" },
  resident: { label: "Resident", text: "Visitors, bookings, orders, payments", color: "indigo" },
  vendor: { label: "Vendor", text: "Manage menu items and orders", color: "orange" },
  practice_admin: { label: "Practice Administrator", text: "Manage practice: patients, appointments, staff", color: "purple" },
  therapist: { label: "Therapist", text: "Run clinical sessions and generate reports", color: "emerald" },
  reception: { label: "Reception", text: "Check-in patients, book appointments", color: "sky" },
  employer_user: { label: "Employer Portal User", text: "Refer employees and view authorised reports", color: "amber" },
};

export function getRolesForTenant(customerType) {
  return customerType === "medical" ? MEDICAL_ROLES : SECURITY_ROLES;
}

export function isMedicalRoleSet(roles) {
  return roles === MEDICAL_ROLES;
}