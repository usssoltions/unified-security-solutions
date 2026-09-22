/**
 * estateApi — frontend wrapper for the estateAccess backend gateway.
 *
 * ALL Estate Management data access goes through the server-side
 * estateAccess gateway — no direct base44.entities CRUD for Estate
 * entities anywhere in the frontend (tenant scoping, validation and
 * notification dispatch are enforced server-side).
 */
import { base44 } from "@/api/base44Client";

async function invoke(action, params = {}) {
  const res = await base44.functions.invoke("estateAccess", { action, ...params });
  return res.data;
}

/* ── Context ──────────────────────────────────────────────────────────── */
export const getEstateContext = () => invoke("get_context");

/* ── Residents (manager directory + onboarding) ───────────────────────── */
export const listResidents = (filter) => invoke("list_residents", { filter });
export const createResident = (data) => invoke("create_resident", { data });
export const updateResident = (id, changes) => invoke("update_resident", { id, changes });
export const deleteResident = (id) => invoke("delete_resident", { id });
export const linkResidentUser = (resident_id, user_id) => invoke("link_resident_user", { resident_id, user_id });
export const unlinkResidentUser = (id) => invoke("unlink_resident_user", { id });

/* ── Properties ───────────────────────────────────────────────────────── */
export const listProperties = (filter) => invoke("list_properties", { filter });
export const createProperty = (data) => invoke("create_property", { data });
export const updateProperty = (id, changes) => invoke("update_property", { id, changes });
export const deleteProperty = (id) => invoke("delete_property", { id });

/* ── Venues ────────────────────────────────────────────────────────────── */
export const listVenues = (filter) => invoke("list_venues", { filter });
export const createVenue = (data) => invoke("create_venue", { data });
export const updateVenue = (id, changes) => invoke("update_venue", { id, changes });
export const deleteVenue = (id) => invoke("delete_venue", { id });

/* ── Venue bookings ────────────────────────────────────────────────────── */
export const listBookings = (filter) => invoke("list_bookings", { filter });
export const createBooking = (data) => invoke("create_booking", { data });
export const updateBooking = (id, changes) => invoke("update_booking", { id, changes });
export const deleteBooking = (id) => invoke("delete_booking", { id });

/* ── Announcements ────────────────────────────────────────────────────── */
export const listAnnouncements = (filter) => invoke("list_announcements", { filter });
export const createAnnouncement = (data) => invoke("create_announcement", { data });
export const updateAnnouncement = (id, changes) => invoke("update_announcement", { id, changes });
export const deleteAnnouncement = (id) => invoke("delete_announcement", { id });
export const publishAnnouncement = (id) => invoke("publish_announcement", { id });

/* ── Voting ────────────────────────────────────────────────────────────── */
export const listQuestions = (filter) => invoke("list_questions", { filter });
export const createQuestion = (data) => invoke("create_question", { data });
export const updateQuestion = (id, changes) => invoke("update_question", { id, changes });
export const deleteQuestion = (id) => invoke("delete_question", { id });
export const openQuestion = (id) => invoke("open_question", { id });
export const castVote = (question_id, option_indices) =>
  base44.functions.invoke("castVote", { question_id, option_indices }).then((r) => r.data);

/* ── Service tickets ───────────────────────────────────────────────────── */
export const listTickets = (filter) => invoke("list_tickets", { filter });
export const createTicket = (data) => invoke("create_ticket", { data });
export const updateTicket = (id, changes) => invoke("update_ticket", { id, changes });
export const deleteTicket = (id) => invoke("delete_ticket", { id });

/* ── Vendors & menu ────────────────────────────────────────────────────── */
export const listVendors = (filter) => invoke("list_vendors", { filter });
export const createVendor = (data) => invoke("create_vendor", { data });
export const updateVendor = (id, changes) => invoke("update_vendor", { id, changes });
export const deleteVendor = (id) => invoke("delete_vendor", { id });
export const listMenuItems = (filter) => invoke("list_menu_items", { filter });
export const saveMenuItem = (data) => invoke("save_menu_item", { data });
export const deleteMenuItem = (id) => invoke("delete_menu_item", { id });

/* ── Laundry ───────────────────────────────────────────────────────────── */
export const listLaundry = (filter) => invoke("list_laundry", { filter });
export const createLaundry = (data) => invoke("create_laundry", { data });
export const updateLaundry = (id, changes) => invoke("update_laundry", { id, changes });
export const deleteLaundry = (id) => invoke("delete_laundry", { id });

/* ── Orders ────────────────────────────────────────────────────────────── */
export const listOrders = (filter) => invoke("list_orders", { filter });
export const createOrder = (data) => invoke("create_order", { data });
export const updateOrder = (id, changes) => invoke("update_order", { id, changes });
export const deleteOrder = (id) => invoke("delete_order", { id });