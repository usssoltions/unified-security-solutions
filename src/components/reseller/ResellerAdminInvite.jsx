/**
 * ResellerAdminInvite — compatibility re-export.
 *
 * The reseller/platform invitation UI and the Customer Administrator
 * invitation UI were UNIFIED into the single shared TenantUserInviteForm
 * (same component, same inviteTenantUser backend contract, same field set).
 * Existing importers (ResellerUsers, CustomerConsole) keep their exact
 * props — the component adapts by caller scope.
 */
export { default } from "@/components/users/TenantUserInviteForm";