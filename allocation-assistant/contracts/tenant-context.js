/**
 * TenantContext Contract Validator
 */

function validateTenantContext(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('TenantContext must be a non-null object');
  }

  const tenantId = (data.tenantId || '').toString().trim();
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const companyId = (data.companyId || '').toString().trim();
  if (!companyId) {
    throw new Error('companyId is required');
  }

  return {
    tenantId,
    companyId,
    timezone: data.timezone || 'Asia/Taipei',
    locale: data.locale || 'zh-TW'
  };
}

module.exports = {
  validateTenantContext
};
