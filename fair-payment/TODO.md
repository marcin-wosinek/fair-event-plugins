# Fair Payment OAuth Migration - TODO

## Status: Phase 1 & 2 Complete ✅

OAuth authentication is now implemented and working alongside API keys. The plugin supports both methods with OAuth preferred.

## Completed

- ✅ OAuth database schema (Settings.php)
- ✅ SiteIdManager for unique site identification
- ✅ MolliePaymentHandler OAuth support with automatic token refresh
- ✅ Settings UI refactored with OAuth connection flow
- ✅ OAuth callback handling
- ✅ Backward compatibility maintained

## Remaining: API Key Cleanup

### 1. Remove API Key Fallback

**File**: `src/Payment/MolliePaymentHandler.php`

Update constructor to require OAuth only:

```php
public function __construct() {
    $this->mollie = new MollieApiClient();
    $this->set_access_token(); // Remove fallback to set_api_key()
}
```

Update `is_configured()` to check OAuth only:

```php
public static function is_configured() {
    return (bool) get_option('fair_payment_mollie_connected', false);
}
```

**Optional**: Remove `set_api_key()` method entirely (or keep for 30 days).

### 3. Cleanup Old API Key Settings

**File**: `src/Settings/Settings.php`

After 30-day grace period:
- Remove registration of `fair_payment_test_api_key`
- Remove registration of `fair_payment_live_api_key`

Add cleanup hook to delete old keys:

```php
// In activation hook or daily cron
if (get_option('fair_payment_mollie_connected')) {
    delete_option('fair_payment_test_api_key');
    delete_option('fair_payment_live_api_key');
}
```

## Migration Timeline

1. **Now**: Deploy with OAuth + API key support (done)
2. **Week 1**: Show migration notices to API key users
3. **Week 2-4**: Grace period for migration
4. **Week 4**: Remove API key fallback from MolliePaymentHandler
5. **Week 8**: Remove API key settings registration

## Testing Checklist

Before removing API key support:

- [ ] Test OAuth connection flow on fresh install
- [ ] Test OAuth reconnection after disconnect
- [ ] Test automatic token refresh (expire token manually)
- [ ] Test payment creation with OAuth tokens
- [ ] Test test/live mode toggle
- [ ] Verify migration notice appears for API key users
- [ ] Test error handling when OAuth connection fails

## Notes

- OAuth tokens work for both test and live modes
- Token refresh happens automatically (5-minute buffer before expiry)
- fair-platform URL: `https://fair-event-plugins.com/oauth/*`
- Site ID generated from `hash('sha256', home_url() . ABSPATH)`
