import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getLinkusConfig — Returns Linkus external calling configuration.
 *
 * Modes:
 *  - disabled: USS internal calling only
 *  - linkus_mobile: Attempts to open Yeastar Linkus Mobile Client via a URI scheme.
 *  - system_dialler: Opens system phone dialler with the number (VERIFIED safe fallback)
 *
 * IMPORTANT — LINKUS URI VERIFICATION STATUS:
 *   The `linkusmobile://dial?number=` URI scheme is NOT confirmed in any official
 *   Yeastar documentation as a supported deep-link / custom URL scheme.
 *   The official Yeastar third-party integration path is the Linkus SDK
 *   (https://help.yeastar.com/en/p-series-linkus-cloud-edition/linkus-sdk-guide/).
 *   The `uri_scheme_verified` flag is therefore false by default.
 *
 *   System dialler (tel:) is the verified safe fallback and is always retained.
 *
 *   If a customer confirms the URI works on their device with their installed
 *   Linkus app, an admin may set uri_scheme_verified=true in SystemConfiguration
 *   to suppress the frontend warning.
 *
 * If Linkus app / URI is not available, the frontend falls back to system dialler (tel:).
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const cid = caller.customer_id;

    // Fetch calling configuration from SystemConfiguration
    const configs = await base44.asServiceRole.entities.SystemConfiguration.filter({
      config_key: 'calling_config',
      module_key: 'CALLING'
    });

    let config = {
      mode: 'disabled', // disabled | linkus_mobile | system_dialler
      linkus_package: 'com.yeastar.linkus', // actual Google Play package name
      linkus_uri_scheme: 'linkusmobile://dial?number=',
      uri_scheme_verified: false, // NOT confirmed in official Yeastar docs
      fallback_to_dialler: true,
      external_prefix: '0', // Prefix for external numbers
    };

    // Find the config for this customer
    const customerConfig = configs.find(c => c.customer_id === cid);
    if (customerConfig?.config_value) {
      try {
        const parsed = JSON.parse(customerConfig.config_value);
        config = { ...config, ...parsed };
      } catch (e) {}
    }

    return Response.json({ success: true, config });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}