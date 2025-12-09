# Mollie Payment Integration

This document describes the Mollie payment integration in the Fair Payment plugin.

## Overview

The integration allows content authors to place payment blocks on pages/posts where users can make payments via Mollie's payment gateway. The system handles the complete payment flow from creation to webhook notifications.

## Architecture

### Components

1. **Payment Block** (`src/blocks/simple-payment/`)
   - Block editor component for configuring payment amount, currency, and description
   - Frontend rendering with "Pay Now" button
   - Client-side JavaScript to handle payment initiation

2. **REST API Endpoints** (`src/API/`)
   - `POST /wp-json/fair-payment/v1/payments` - Creates a payment
   - `POST /wp-json/fair-payment/v1/webhook` - Handles Mollie webhooks

3. **Payment Handler** (`src/Payment/MolliePaymentHandler.php`)
   - Integrates with Mollie PHP API client
   - Handles payment creation and status retrieval
   - Supports test and live modes

4. **Transaction Model** (`src/Models/Transaction.php`)
   - Database operations for payment transactions
   - Stores payment records with Mollie payment IDs

5. **Database Schema** (`src/Database/Schema.php`)
   - Creates `wp_fair_payment_transactions` table
   - Stores transaction details and status

6. **Admin Pages** (`src/Admin/AdminPages.php`)
   - Settings page for API key configuration
   - Transactions page to view payment history

## Payment Flow

### 1. Content Author Setup
- Author adds "Simple Payment" block to a page/post
- Configures amount (e.g., "10.00"), currency (e.g., "EUR"), and optional description
- Publishes the page

### 2. User Initiates Payment
- User visits the page and clicks "Pay Now" button
- Frontend JavaScript calls REST API endpoint
- System creates transaction record in database
- Mollie payment is created via API
- User is redirected to Mollie checkout page

### 3. Mollie Payment Process
- User completes payment on Mollie's secure checkout
- After completion, user is redirected back to the original page
- Success message is displayed

### 4. Webhook Notification
- Mollie sends webhook notification to `/wp-json/fair-payment/v1/webhook`
- System retrieves payment status from Mollie API
- Transaction status is updated in database
- Action hooks are fired for custom processing:
  - `fair_payment_paid` - Payment successful
  - `fair_payment_failed` - Payment failed/canceled/expired
  - `fair_payment_authorized` - Payment authorized
  - `fair_payment_status_changed` - Any status change

## Configuration

### API Keys

1. Navigate to **Fair Payment > Settings** in WordPress admin
2. Configure API keys:
   - **Test API Key**: For testing (starts with `test_`)
   - **Live API Key**: For production (starts with `live_`)
3. Set the mode (test or live)

Get your API keys from: https://www.mollie.com/dashboard/developers/api-keys

### Database

The plugin automatically creates the required table on activation:

```sql
CREATE TABLE wp_fair_payment_transactions (
    id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    mollie_payment_id varchar(50) NOT NULL,
    post_id bigint(20) UNSIGNED DEFAULT NULL,
    user_id bigint(20) UNSIGNED DEFAULT NULL,
    amount decimal(10,2) NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'EUR',
    status varchar(20) NOT NULL DEFAULT 'open',
    description text DEFAULT NULL,
    redirect_url text DEFAULT NULL,
    webhook_url text DEFAULT NULL,
    checkout_url text DEFAULT NULL,
    metadata longtext DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY mollie_payment_id (mollie_payment_id),
    KEY status (status),
    KEY user_id (user_id),
    KEY post_id (post_id)
)
```

## Payment Statuses

The system handles all Mollie payment statuses:

- `open` - Payment created, awaiting action
- `pending` - Payment processing started
- `authorized` - Payment authorized (for manual capture)
- `paid` - Payment successfully completed
- `failed` - Payment failed
- `canceled` - Payment canceled by user
- `expired` - Payment expired

## Action Hooks

Developers can hook into payment events:

```php
// Payment successful
add_action('fair_payment_paid', function($payment, $transaction) {
    // Send confirmation email
    // Grant access to content
    // Update user meta
}, 10, 2);

// Payment failed
add_action('fair_payment_failed', function($payment, $transaction) {
    // Log failure
    // Notify admin
}, 10, 2);

// Any status change
add_action('fair_payment_status_changed', function($payment, $transaction) {
    // Custom processing
}, 10, 2);
```

## Development & Testing

### Test Mode

1. Set mode to "test" in settings
2. Use test API key
3. Use Mollie test payment methods:
   - Test credit cards
   - Ideal test issuer
   - Other test methods

### Webhook Testing

For local development, use a tool like ngrok to expose your local site:

```bash
ngrok http 8080
```

Then use the ngrok URL in your test environment.

## Security Considerations

1. **API Keys**: Stored in WordPress options, accessible only to administrators
2. **Nonce Protection**: Not required as REST API uses WordPress authentication
3. **Input Sanitization**: All user inputs are sanitized
4. **Output Escaping**: All outputs are escaped
5. **Webhook Verification**: Payment status verified by fetching from Mollie API
6. **SQL Injection**: All database queries use prepared statements

## Files Created

- `src/Payment/MolliePaymentHandler.php` - Mollie API integration
- `src/API/PaymentEndpoint.php` - Payment creation endpoint
- `src/API/WebhookEndpoint.php` - Webhook handler
- `src/Models/Transaction.php` - Transaction database model
- `src/Database/Schema.php` - Database schema management
- `src/blocks/simple-payment/view.js` - Frontend payment button handler

## Dependencies

- `mollie/mollie-api-php`: ^2.0 - Official Mollie PHP API client

## References

- [Mollie API Documentation](https://docs.mollie.com/)
- [Mollie Payments API](https://docs.mollie.com/docs/online-payments)
- [Mollie Webhooks](https://docs.mollie.com/docs/triggering-fulfilment)
