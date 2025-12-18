# Webhook Integration with fair-payment

## Overview

Fair-membership automatically marks user fees as paid when payment is confirmed by Mollie via webhooks.

## How It Works

### 1. Payment Creation
When a user clicks "Pay Now" on a fee (via the my-fees block or admin interface):

```php
// In UserFeeController::create_payment()
$transaction_id = fair_payment_create_transaction(
    [['name' => $fee->title, 'quantity' => 1, 'amount' => $fee->amount]],
    [
        'metadata' => [
            'user_fee_id' => $fee->id,
            'plugin' => 'fair-membership'
        ]
    ]
);
```

The metadata stores:
- `user_fee_id` - Links back to the fair-membership user fee
- `plugin` - Identifies this as a fair-membership transaction

### 2. Webhook Processing
When Mollie confirms payment, fair-payment receives a webhook and fires:
```php
do_action('fair_payment_paid', $payment, $transaction);
```

### 3. Automatic Fee Update
Fair-membership's `PaymentHooks` class listens for this hook:

```php
// In PaymentHooks::handle_payment_paid()
public function handle_payment_paid($payment, $transaction) {
    $metadata = json_decode($transaction->metadata, true);

    // Check if this is our transaction
    if ($metadata['plugin'] === 'fair-membership' && isset($metadata['user_fee_id'])) {
        $user_fee = UserFee::get_by_id($metadata['user_fee_id']);
        $user_fee->mark_as_paid(); // Sets status='paid', paid_at=now
    }
}
```

## Architecture

### Components

**`src/Hooks/PaymentHooks.php`**
- Registers hook listeners for payment events
- Processes successful payments (`fair_payment_paid`)
- Handles failed payments (`fair_payment_failed`)
- Validates transaction metadata
- Updates user fee status

**`src/Core/Plugin.php`**
- Instantiates `PaymentHooks` on plugin initialization
- Loaded for all requests (webhooks can come anytime)

**`src/API/UserFeeController.php`**
- Creates transactions with proper metadata
- Includes `user_fee_id` and `plugin` identifier

### Webhook Flow Diagram

```
User clicks "Pay Now"
         ↓
fair-membership creates transaction
         ↓
User redirected to Mollie checkout
         ↓
User completes payment
         ↓
Mollie → fair-payment webhook endpoint
         ↓
fair-payment updates transaction status
         ↓
fair-payment fires 'fair_payment_paid' hook
         ↓
fair-membership PaymentHooks receives event
         ↓
Validates metadata (plugin='fair-membership')
         ↓
Loads UserFee by user_fee_id
         ↓
Calls mark_as_paid()
         ↓
Fee status updated to 'paid'
```

## Error Handling

### Failed Payments
When payment fails (status: failed, canceled, expired):
- Hook: `fair_payment_failed`
- Action: Logs failure, fee remains 'pending'/'overdue'
- User can attempt payment again

### Missing Fee
If user_fee_id not found:
- Logs error with transaction ID
- Does not crash webhook processing
- Other plugins' webhooks still processed

### Exception Handling
Any exception during `mark_as_paid()`:
- Logged to error_log
- Webhook returns 200 OK to Mollie (prevents retries)
- Transaction status updated correctly in fair-payment

## Testing

### Manual Test
1. Create a user fee in admin
2. View the fee in the my-fees block (frontend)
3. Click "Pay Now"
4. Complete payment at Mollie checkout
5. Mollie sends webhook to fair-payment
6. Check user fee status changes to 'paid' in admin

### Debug Logging
Enable WordPress debug logging:
```php
// wp-config.php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
```

Check `/wp-content/debug.log` for:
```
Fair Membership: User fee #123 marked as paid via transaction #456 (Mollie payment: tr_xxxxx)
```

## Decoupling

This implementation uses WordPress action hooks, which provides loose coupling:
- fair-payment doesn't know about fair-membership
- fair-membership doesn't modify fair-payment
- Other plugins can create their own webhook handlers
- Transaction metadata is the only shared contract

## Future Improvements

Potential enhancements (not yet implemented):
- Event type registry for more structured callbacks
- Retry logic for failed webhook processing
- Admin UI to view payment history per fee
- Webhook signature verification for security
- Support for partial payments
