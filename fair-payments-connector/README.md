# Fair Payments Connector

Mollie-based payments and bookkeeping for WordPress events — the money layer of the Fair Event plugin suite.

## Features

- **Mollie gateway** — test/live modes, application fees, webhook handling, proactive status sync for stuck payments
- **Transactions** — itemized line items, linked to posts, event dates (fair-events), and participants (fair-audience); status lifecycle with action hooks (`fair_payment_paid`, etc.)
- **Bookkeeping ledger** — budgets and financial entries with split entries, event linkage, import deduplication, and many-to-many reconciliation against bank-import entries
- **Data sharing API** — token-authenticated endpoints so satellite sites can pull their own transactions from a hub site
- **Telegram notifications** on payment events
- **Simple Payment block** (Gutenberg) with amount, currency, and description attributes
- **Admin pages** for transactions, budgets, entries, reconciliation, API tokens, connected sites, and settings

## Public PHP API

Other plugins integrate via four global functions in `fair-payments-connector.php`:

- `fair_payment_create_transaction( $line_items, $args )`
- `fair_payment_initiate_payment( $transaction_id, $args )`
- `fair_payment_get_transaction( $transaction_id )`
- `fair_payment_sync_transaction_status( $transaction_id )`

## Development

### Install dependencies

```bash
npm install
composer install
```

### Build

```bash
npm run build
```

### Development mode

```bash
npm run start
```

### Format code

```bash
npm run format
```

## Structure

- `src/blocks/simple-payment/` — Gutenberg payment block
- `src/Core/` — plugin bootstrap (singleton)
- `src/Database/` — schema, migrations, log repository
- `src/Models/` — Transaction, LineItem, Budget, FinancialEntry, EntryTransaction, ApiToken, ConnectedSite, PaymentLog
- `src/Payment/` — Mollie payment handler
- `src/API/` — REST controllers (transactions, budgets, entries, reconciliation, webhook, payment endpoint, API tokens, connected sites, external transactions, payment log, Telegram settings) and the public `TransactionAPI` facade
- `src/Admin/` — React admin pages and PHP menu wiring
- `src/Settings/` — settings registration
- `src/OAuth/` — site identity for cross-site data sharing
- `src/Services/` — Telegram service
- `src/Hooks/` — notification hooks
