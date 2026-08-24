import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getLinkusConfig — Returns Linkus external calling configuration.
 *
 * Modes:
 *  - disabled: USS internal calling only
 *  - linkus_mobile: Opens Yeastar Linkus Mobile Client app
 *  - system_dialler: Opens system phone dialler with the number
 *
 * The actual Linkus URI scheme is the official Yeastar format:
 *   linkusmobile://dial?number=<phone>
 *
 * If Linkus is not installed, the frontend falls back to system dialler (tel:).
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
      linkus_package: 'com.yeastar.linkusmobile',
      linkus_uri_scheme: 'linkusmobile://dial?number=',
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