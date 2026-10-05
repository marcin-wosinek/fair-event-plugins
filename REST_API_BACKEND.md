# REST API Backend Standards for Fair Event Plugins

This document defines security standards and best practices for implementing WordPress REST API endpoints in Fair Event Plugins.

**Canonical live examples**: `fair-events/src/API/` and `fair-audience/src/API/`
— when this doc and real code disagree on style details, follow the code and
fix the doc.

## File Organization and Project Structure

### Standard Directory Structure

**ALL plugins MUST use this standardized structure:**

```
fair-plugin-name/
├── src/
│   └── API/                           # REST API directory (uppercase "API")
│       ├── PluginNameController.php   # Main resource controller
│       └── OtherController.php        # Additional controllers
```

### Registration Pattern

REST API routes are registered in the plugin's main initialization (typically in `Plugin.php` or similar):

```php
<?php
// fair-plugin-name/src/Core/Plugin.php

namespace FairPluginName\Core;

use FairPluginName\API\PluginNameController;

class Plugin {
    public function __construct() {
        add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
    }

    public function register_api_endpoints() {
        $controller = new PluginNameController();
        $controller->register_routes();
    }
}
```

### Controller Template

```php
<?php
// fair-plugin-name/src/API/PluginNameController.php

namespace FairPluginName\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

class PluginNameController extends WP_REST_Controller {

    protected $namespace = 'fair-plugin-name/v1';
    protected $rest_base = 'items';

    public function register_routes() {
        register_rest_route(
            $this->namespace,
            '/' . $this->rest_base,
            array(
                array(
                    'methods'             => WP_REST_Server::CREATABLE,
                    'callback'            => array( $this, 'create_item' ),
                    'permission_callback' => array( $this, 'create_item_permissions_check' ),
                    'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::CREATABLE ),
                ),
            )
        );
    }

    public function create_item_permissions_check( $request ) {
        return is_user_logged_in();
    }

    public function create_item( $request ) {
        // Implementation
    }
}
```

### Why `src/API/` (uppercase)?

1. **Case sensitivity**: Linux (production) is case-sensitive, macOS (development) is not. Uppercase "API" is a common acronym convention that avoids confusion
2. **Consistency**: Matches other namespace patterns in WordPress ecosystem
3. **PSR-4 Autoloading**: Clear mapping between namespace `PluginName\API` and directory `src/API/`

---

## Required Standards for All REST API Endpoints

### 1. MUST Verify WordPress REST API Nonce

WordPress REST API uses cookie authentication with nonce verification automatically **when using `apiFetch()`** from the frontend. However, you must ensure proper permission callbacks are in place.

**How WordPress REST API Nonce Works:**

When using `apiFetch()` from `@wordpress/api-fetch`:

```javascript
// Frontend automatically includes nonce in headers
await apiFetch({
    path: '/plugin-name/v1/endpoint',
    method: 'POST',
    data: { ... }
});
```

WordPress automatically:

1. Checks the `X-WP-Nonce` header
2. Validates the nonce matches the current user session
3. Rejects requests with invalid/missing nonces (returns 401)

**Your responsibility:** Set appropriate `permission_callback` to enforce authentication.

### 2. MUST Use Appropriate Permission Callbacks

**NEVER use `__return_true` for authenticated endpoints:**

```php
// ❌ WRONG - Anyone can access
'permission_callback' => '__return_true'

// ✅ CORRECT - Require logged-in user
'permission_callback' => 'is_user_logged_in'

// ✅ CORRECT - Require admin
'permission_callback' => function() {
    return current_user_can( 'manage_options' );
}

// ✅ CORRECT - Custom check
'permission_callback' => array( $this, 'check_permissions' )
```

### 3. Permission Callback Patterns

#### Pattern 1: Public Endpoint (Use Sparingly)

```php
// Only for truly public endpoints (webhooks from external services, public data)
'permission_callback' => '__return_true'

// MUST add additional validation inside the callback:
public function handle_webhook( $request ) {
    // Verify webhook signature/token
    if ( ! $this->verify_webhook_signature( $request ) ) {
        return new WP_Error( 'invalid_signature', 'Invalid webhook signature', array( 'status' => 403 ) );
    }
    // ... process webhook
}
```

#### Pattern 2: Logged-In Users Only

```php
'permission_callback' => function() {
    return is_user_logged_in();
}

// Or with custom method:
'permission_callback' => array( $this, 'require_logged_in' )

public function require_logged_in( $request ) {
    if ( ! is_user_logged_in() ) {
        return new WP_Error(
            'rest_forbidden',
            __( 'You must be logged in.', 'plugin-name' ),
            array( 'status' => 401 )
        );
    }
    return true;
}
```

#### Pattern 3: Admin/Editor Only

```php
'permission_callback' => function() {
    return current_user_can( 'manage_options' );
}

// Or for editors and above:
'permission_callback' => function() {
    return current_user_can( 'edit_posts' );
}
```

#### Pattern 4: Resource Owner Only

```php
'permission_callback' => array( $this, 'check_resource_owner' )

public function check_resource_owner( $request ) {
    if ( ! is_user_logged_in() ) {
        return new WP_Error( 'rest_forbidden', 'Not logged in', array( 'status' => 401 ) );
    }

    $resource_id = $request->get_param( 'id' );
    $resource = $this->get_resource( $resource_id );

    if ( ! $resource ) {
        return new WP_Error( 'not_found', 'Resource not found', array( 'status' => 404 ) );
    }

    // Check if current user owns this resource or is admin
    if ( $resource->user_id !== get_current_user_id() && ! current_user_can( 'manage_options' ) ) {
        return new WP_Error( 'rest_forbidden', 'You do not have permission', array( 'status' => 403 ) );
    }

    return true;
}
```

### 4. MUST Extend WP_REST_Controller

All REST API controllers extend `WP_REST_Controller`, declare protected
`$namespace` (`plugin-name/v1`) and `$rest_base` properties, and use
`WP_REST_Server` method constants (READABLE, CREATABLE, EDITABLE, DELETABLE).
See the [Standard Endpoint Implementation Template](#standard-endpoint-implementation-template)
below — that template is the single canonical one for this repo.

### 5. MUST Validate and Sanitize Inputs

```php
'args' => array(
    'email' => array(
        'required'          => true,
        'type'              => 'string',
        'format'            => 'email',
        'sanitize_callback' => 'sanitize_email',
        'validate_callback' => function( $param ) {
            return is_email( $param );
        },
    ),
    'amount' => array(
        'required'          => true,
        'type'              => 'number',
        'minimum'           => 0,
        'validate_callback' => function( $param ) {
            return is_numeric( $param ) && $param > 0;
        },
    ),
    'status' => array(
        'type'              => 'string',
        'enum'              => array( 'active', 'inactive', 'pending' ),
        'sanitize_callback' => 'sanitize_text_field',
    ),
),
```

### 6. MUST Return Proper Error Codes

```php
// 400 - Bad Request (validation error)
return new WP_Error(
    'invalid_param',
    __( 'Invalid parameter provided.', 'plugin-name' ),
    array( 'status' => 400 )
);

// 401 - Unauthorized (not logged in)
return new WP_Error(
    'rest_forbidden',
    __( 'You must be logged in.', 'plugin-name' ),
    array( 'status' => 401 )
);

// 403 - Forbidden (logged in but no permission)
return new WP_Error(
    'rest_forbidden',
    __( 'You do not have permission to perform this action.', 'plugin-name' ),
    array( 'status' => 403 )
);

// 404 - Not Found
return new WP_Error(
    'not_found',
    __( 'Resource not found.', 'plugin-name' ),
    array( 'status' => 404 )
);

// 500 - Internal Server Error
return new WP_Error(
    'internal_error',
    __( 'An internal error occurred.', 'plugin-name' ),
    array( 'status' => 500 )
);
```

---

## Standard Endpoint Implementation Template

```php
<?php
/**
 * REST API Controller for [Resource]
 *
 * @package PluginName
 */

namespace PluginName\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * [Resource] REST API controller
 */
class ResourceController extends WP_REST_Controller {

    /**
     * Namespace for the REST API
     *
     * @var string
     */
    protected $namespace = 'plugin-name/v1';

    /**
     * Resource name
     *
     * @var string
     */
    protected $rest_base = 'resources';

    /**
     * Register the routes
     *
     * @return void
     */
    public function register_routes() {
        // GET /plugin-name/v1/resources
        register_rest_route(
            $this->namespace,
            '/' . $this->rest_base,
            array(
                array(
                    'methods'             => WP_REST_Server::READABLE,
                    'callback'            => array( $this, 'get_items' ),
                    'permission_callback' => array( $this, 'get_items_permissions_check' ),
                    'args'                => $this->get_collection_params(),
                ),
                array(
                    'methods'             => WP_REST_Server::CREATABLE,
                    'callback'            => array( $this, 'create_item' ),
                    'permission_callback' => array( $this, 'create_item_permissions_check' ),
                    'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::CREATABLE ),
                ),
            )
        );

        // GET /plugin-name/v1/resources/{id}
        register_rest_route(
            $this->namespace,
            '/' . $this->rest_base . '/(?P<id>[\d]+)',
            array(
                array(
                    'methods'             => WP_REST_Server::READABLE,
                    'callback'            => array( $this, 'get_item' ),
                    'permission_callback' => array( $this, 'get_item_permissions_check' ),
                    'args'                => array(
                        'id' => array(
                            'description' => __( 'Unique identifier for the resource.', 'plugin-name' ),
                            'type'        => 'integer',
                        ),
                    ),
                ),
                array(
                    'methods'             => WP_REST_Server::EDITABLE,
                    'callback'            => array( $this, 'update_item' ),
                    'permission_callback' => array( $this, 'update_item_permissions_check' ),
                    'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::EDITABLE ),
                ),
                array(
                    'methods'             => WP_REST_Server::DELETABLE,
                    'callback'            => array( $this, 'delete_item' ),
                    'permission_callback' => array( $this, 'delete_item_permissions_check' ),
                ),
            )
        );
    }

    /**
     * Get items permissions check
     *
     * @param WP_REST_Request $request Request object.
     * @return bool|WP_Error
     */
    public function get_items_permissions_check( $request ) {
        // For listing: require logged in
        if ( ! is_user_logged_in() ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You must be logged in to view resources.', 'plugin-name' ),
                array( 'status' => 401 )
            );
        }
        return true;
    }

    /**
     * Create item permissions check
     *
     * @param WP_REST_Request $request Request object.
     * @return bool|WP_Error
     */
    public function create_item_permissions_check( $request ) {
        // For creation: require appropriate capability
        if ( ! current_user_can( 'edit_posts' ) ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You do not have permission to create resources.', 'plugin-name' ),
                array( 'status' => 403 )
            );
        }
        return true;
    }

    /**
     * Get item permissions check
     *
     * @param WP_REST_Request $request Request object.
     * @return bool|WP_Error
     */
    public function get_item_permissions_check( $request ) {
        if ( ! is_user_logged_in() ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You must be logged in.', 'plugin-name' ),
                array( 'status' => 401 )
            );
        }

        $item = $this->get_resource( $request->get_param( 'id' ) );

        if ( ! $item ) {
            return new WP_Error(
                'not_found',
                __( 'Resource not found.', 'plugin-name' ),
                array( 'status' => 404 )
            );
        }

        // Check ownership or admin
        if ( $item->user_id !== get_current_user_id() && ! current_user_can( 'manage_options' ) ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You do not have permission to view this resource.', 'plugin-name' ),
                array( 'status' => 403 )
            );
        }

        return true;
    }

    /**
     * Update item permissions check
     *
     * @param WP_REST_Request $request Request object.
     * @return bool|WP_Error
     */
    public function update_item_permissions_check( $request ) {
        // Same logic as get_item for updates
        return $this->get_item_permissions_check( $request );
    }

    /**
     * Delete item permissions check
     *
     * @param WP_REST_Request $request Request object.
     * @return bool|WP_Error
     */
    public function delete_item_permissions_check( $request ) {
        // More restrictive: require admin or ownership + delete capability
        if ( ! is_user_logged_in() ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You must be logged in.', 'plugin-name' ),
                array( 'status' => 401 )
            );
        }

        $item = $this->get_resource( $request->get_param( 'id' ) );

        if ( ! $item ) {
            return new WP_Error(
                'not_found',
                __( 'Resource not found.', 'plugin-name' ),
                array( 'status' => 404 )
            );
        }

        // Only owner or admin can delete
        if ( $item->user_id !== get_current_user_id() && ! current_user_can( 'manage_options' ) ) {
            return new WP_Error(
                'rest_forbidden',
                __( 'You do not have permission to delete this resource.', 'plugin-name' ),
                array( 'status' => 403 )
            );
        }

        return true;
    }

    // Implement callback methods: get_items(), create_item(), get_item(), update_item(), delete_item()
    // ...
}
```

---

## Testing REST API Security

### Manual Testing

```bash
# Test without authentication (should fail for protected endpoints)
curl -X POST http://localhost:8080/wp-json/fair-payments-connector/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"amount":"10.00","currency":"EUR"}'

# Test with valid nonce (should succeed)
# Get nonce from browser console: wp.apiFetch.nonceMiddleware.nonce
curl -X POST http://localhost:8080/wp-json/fair-payments-connector/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-WP-Nonce: YOUR_NONCE_HERE" \
  -H "Cookie: YOUR_COOKIES_HERE" \
  -d '{"amount":"10.00","currency":"EUR"}'
```

### Automated Testing

Every REST controller gets a Playwright API spec in `src/API/__tests__/`
(see [TESTING.md](./TESTING.md)) that verifies:

-   Permission callbacks work correctly
-   Unauthorized requests return 401/403
-   Valid requests succeed

---

## Cross-Plugin Extension Hooks

When a companion plugin (e.g. `fair-audience`) needs to enrich or react to a
base plugin's REST create path — instead of registering a competing route
that duplicates validation, pricing, and payment logic — expose the seam as a
filter (for shaping data before it's used) and/or an action (for reacting
after a write completes). This keeps the base route the single source of
truth and lets experimental features stay additive.

### Example: `fair-events` unified signup

`fair-events/src/blocks/event-signup/render.php` (base render — the
cache-safe baseline every viewer gets, see below),
`fair-events/src/Services/SignupFieldsetRenderer.php` (the ticket-type/
ticket-options fieldset markup, shared between the base render and the
viewer-context endpoint), and `fair-events/src/API/GetTicketsController.php`
(the `fair-events/v1/get-tickets` create route, plus its `viewer-context`
sub-route) expose:

-   **`fair_events_signup_render_context` filter** — the base render builds a
    context array (`event_date_id`, `pricing_event_date_id`, `ticket_types`,
    `price_by_type_id`, `active_sale_period`, `occurrences_for_picker`,
    `ticket_options`, `minimum_activities`,
    `callback_status`/`callback_tx_id`/`callback_token`, `prefill_name`,
    `prefill_email`, `submit_button_text`, `suppress_form`) and runs it
    through this filter before rendering. Since a full-page cache stores and
    replays this render for every viewer (#1300), `ticket_types` here already
    excludes any group-restricted tier, and `prefill_name`/`prefill_email`/
    `suppress_form`/every occurrence's `signed_up` are always their
    viewer-independent defaults (`''`/`''`/`false`/`false`) — **no consumer
    may set viewer-dependent state through this filter.** It exists only for
    a future genuinely viewer-independent extension; fair-audience does not
    hook it. Per-viewer personalization is resolved by the
    `fair_events_signup_viewer_context` filter below instead.
-   **`fair_events_signup_viewer_context` filter** — resolved at request time
    by `GetTicketsController::get_viewer_context()`
    (`GET fair-events/v1/get-tickets/viewer-context?event_date_id=…`, with an
    optional sanitized `participant_token`), never by the render a
    full-page cache stores. frontend.js calls this endpoint after load for
    every page view — cached or not — and patches the response into the DOM,
    so the visible result never depends on who the page happened to be
    rendered for. The endpoint rebuilds the same-shaped context as
    `fair_events_signup_render_context` above, but *unfiltered* (including
    group-restricted tiers), plus a `viewer_resolved` key (`false` by
    default), the optional request token, and
    `token_identity_validated` (`false` by default). A companion plugin
    validates the token server-side and sets `viewer_resolved = true` whenever it
    recognises the viewer (fair-audience's
    `SignupHookBridge::enrich_render_context()` — the same method, now
    hooked to this filter instead) and overrides `ticket_types`/
    `price_by_type_id` (participant-filtered/discounted), `prefill_name`/
    `prefill_email`, `suppress_form`, and each `occurrences_for_picker`
    row's `signed_up`, exactly as it used to for the base render. When
    `viewer_resolved` is true the endpoint renders the personalized
    fragments below and returns them as HTML (reusing
    `SignupFieldsetRenderer` and the same render-slot actions the base
    render fires — no templating logic duplicated in JavaScript); an
    unrecognised viewer (the common case) gets an empty/no-op response, so
    no rendering work happens for the anonymous majority. Response shape:
    `viewer_resolved`, `suppress_form`, `ticket_type_fieldset_html` /
    `ticket_options_fieldset_html` (the two fieldsets, HTML or `null`),
    `before_form_html` / `before_submit_html` / `after_form_html` (the three
    render-slot actions' captured output, HTML or `null`),
    `occurrences_signed_up` (event_date_ids), `prefill_name`, `prefill_email`,
    and the non-secret `token_identity_validated` boolean. The token itself and
    participant ID are never returned.
    frontend.js swaps the `<form>` for a `fair-events-get-tickets-companion`
    wrapper client-side when `suppress_form` is true (mirroring what the base
    render used to do server-side), instead of patching the fieldsets.
-   **Three render-slot actions**, all passed the context from whichever
    filter above ran (so they no-op on the base render's un-enriched
    context, and produce fragments on the viewer-context endpoint's enriched
    one): `fair_events_signup_render_before_form` and
    `fair_events_signup_render_after_form` let a companion plugin contribute
    UI fragments (e.g. a resume/retry card, the signed-up/cancel card, or
    fair-audience's "add activities" section) either inside the `<form>` (or
    its client-side companion swap) or inside the base render's (now
    effectively unreachable, kept for future use) `suppress_form` wrapper
    div. A third action, `fair_events_signup_render_before_submit`, fires
    immediately before the submit button — fair-audience uses it to render a
    group discount note. `ticket_options` is a list of
    `[ id, name, short_name, price, is_full ]` resolved by fair-events'
    own `ActivitySelection::offered_options()` — the event's activities that
    have a price right now, with or without a companion plugin; fair-audience's
    `SignupHookBridge::enrich_render_context()` overrides each option's
    `price` with the viewer's group discount and, for a recognised viewer
    already signed up for this
    event date, adds `addable_options` (options they don't already have) and
    `current_activity_names`. `minimum_activities` is the event-date global
    requirement, capped at `count( $ticket_options )`; a ticket type can raise
    it further via its own `minimum_activities` property — see
    `frontend.js`' `getEffectiveActivityMinimum()`.
-   **Idempotency key** — `POST fair-events/v1/get-tickets` accepts an
    optional `idempotency_key` (16–128 characters of `A-Za-z0-9_-`; the
    public form sends a random one). One key is one intended purchase:
    -   The first request with a key saves the key (hashed) with its signup
        row(s) in `fair_events_checkout_keys`, in the same transaction and
        under the same capacity locks, so concurrent requests with one key
        run one after the other and converge on the same purchase. A
        `multiple_instances` checkout has one key for all its signup rows.
    -   A repeated key is resolved **before** the rate limit and before any
        capacity, price or availability check, and never creates another
        signup, ticket unit, capacity reservation, transaction or provider
        payment. It returns the purchase's result: `confirmed` (free, or
        paid meanwhile), or `payment_required` with the same transaction and
        checkout link while that payment is open.
    -   A checkout interrupted part-way (e.g. the provider failed while the
        payment was being started) is continued from what was persisted by
        the next request with its key: the transaction is created only when
        the signups have none, the signup hooks run once, and the payment is
        started through `TransactionAPI::resume_payment()`, which returns an
        open payment as it is instead of creating a second one. No database
        lock is held during the provider call; the request finishing a
        checkout holds a time-limited claim on its key record, and a repeat
        arriving meanwhile waits for it (409 `checkout_in_progress` if it
        takes too long).
    -   The same key with different purchase details is refused with 409
        `idempotency_key_reused`. A key whose purchase failed, was cancelled
        or expired stays used and answers 409 `checkout_closed`; a payment
        in flight at the bank answers 409 `payment_processing`. Buying again
        — after a completed, failed, cancelled or expired checkout alike —
        takes a new key. Retrying a failed payment stays on the
        `retry-payment` route and that checkout's own signups.
    -   Keys of confirmed purchases are kept for good. Others are deleted by
        the hourly cleanup once `CheckoutKey::RETENTION_SECONDS` (30 days)
        passed and none of their signups is confirmed or pending.
    -   A request without a key is not protected against being repeated.
-   **`fair_events_signup_precheck_error` filter** — `GetTicketsController::create_signup()`
    runs this immediately after the event date is validated, before ticket-type
    or options validation, so it covers the single-, `multiple_instances`- and
    no-ticket-type paths alike:
    `apply_filters( 'fair_events_signup_precheck_error', null, $event_date_id, $email, $ticket_type_id, $participant_token )`.
    Returning a `WP_Error` rejects the signup; `null` (the default) allows it
    to proceed. It is not run for a repeated idempotency key. **A participant
    already holding a ticket for the date is not a reason to reject** — each
    checkout is its own purchase (see "Canonical signup store" below), and
    accidental repeats are stopped by the idempotency key, not by the
    participant's relationship. fair-audience no longer hooks this filter
    (it used to return 409 `already_signed_up`).
-   **`fair_events_signup_deferred_response` filter** — `GetTicketsController::create_signup()`
    runs this right after the precheck, still before any signup, participant
    link or payment exists:
    `apply_filters( 'fair_events_signup_deferred_response', null, $submission, $participant_token )`.
    `$submission` holds only sanitized values: `event_date_id`, `name`,
    `email`, `ticket_type_id`, `quantity`, `mailing_opt_in`,
    `ticket_option_ids`, `ticket_activities` (one list per ticket),
    `event_date_ids` and `questionnaire_answers`. Returning an array sends it
    as the response instead of saving anything, and counts as an attempt
    against the rate limit; `null` (the default) lets the signup proceed. Like
    the precheck, it is not run for a repeated idempotency key.
    fair-audience uses it for a typed email that belongs to an existing
    participant the browser is not known to be (no valid participant token,
    no signed-in account with a participant, and no audience session for that
    participant): it stashes the submission, emails a single-use link and
    answers `{ status: 'email_recognized' }`, so a guessed email can neither
    sign someone up nor open a session as them. The link carries
    `participant_token` and `resume`; the unified frontend reads both from
    the URL and fetches the stash once from
    `GET fair-audience/v1/event-signup/resume`, a route fair-audience names
    in its `fair_events_signup_render_before_form` fragment.
-   **`fair_events_signup_ticket_type_error` filter** — `GetTicketsController::create_signup()`
    runs this right after a submitted ticket type is validated and confirmed
    not disabled: `apply_filters( 'fair_events_signup_ticket_type_error', null, $ticket_type_id, $event_date_id, $participant_token )`.
    Returning a `WP_Error` rejects the signup with that error (fair-audience
    returns a 403 `ticket_type_restricted` when the ticket type is
    group-restricted and the viewer isn't a member); returning `null` (the
    default) allows the signup to proceed. Runs once before either the
    single- or `multiple_instances` path dispatches, so it covers both.
-   **`fair_events_signup_unit_price` filter** — runs immediately after
    `TicketPricing::resolve_unit_price()` in both `create_signup()` and
    `create_multi_instance_signup()`: `apply_filters( 'fair_events_signup_unit_price', $unit_price, $ticket_type_id, $event_date_id, $participant_token )`.
    A companion plugin uses this to apply participant-specific discounts (e.g.
    a group pricing rule) on top of the base price; `$unit_price` is `null`
    when no active sale period configures one, which a filter callback should
    pass through unchanged. This is a dedicated seam rather than the
    pre-existing `fair_events_resolve_ticket_price` filter (which is also the
    base price inside `EventSignupPricing::resolve_price_for_ticket_type()` —
    hooking it here would double-discount that path).
-   **Activities for each ticket** — a purchase of several tickets sends
    `ticket_activities`, one list of option IDs per ticket in ticket order
    (up to 100 lists of up to 50 IDs). A single ticket may instead send the
    flat `ticket_option_ids`. A list count that does not match `quantity`, or
    `ticket_option_ids` with a quantity above 1, is refused with 400
    `activity_selection_mismatch`; sending both fields is 400
    `ambiguous_activity_selection`. One selection is never copied across the
    quantity, and the quantity is never reduced to fit it.
-   **Activity selection and pricing are owned by fair-events.**
    `GetTicketsController::create_signup()` validates each distinct selection
    among the purchase's tickets with
    `FairEvents\Services\ActivitySelection::validate()` — unconditionally
    (outside the `if ( $ticket_type_id )` block, so a global
    minimum-activities requirement still applies to a signup with no ticket
    type). It returns 400 `invalid_ticket_option` for an ID that doesn't
    belong to the event date, 409 `ticket_option_unavailable` naming an
    activity that has no price for the sale period on sale, 409
    `ticket_option_full` naming the activity when it has no capacity left,
    400 `activities_disabled` / `maximum_activities_exceeded` /
    `minimum_activities_not_met` when the selection breaks the ticket type's
    rule, and 409 `activity_minimum_unavailable` when too few activities can
    be selected at all. Capacity across all of the purchase's tickets is
    enforced afterwards by `TicketCapacity`, under its lock.
    `FairEvents\Services\ActivityOptionPriceResolver` resolves each
    activity's base price (a flat price, or the row for the active sale
    period); a missing price is unavailable, never free. The signup render
    and `GET /get-tickets/viewer-context` use the same resolver through
    `ActivitySelection::offered_options()`, so an unavailable activity is
    not offered in the first place.
-   **`fair_events_signup_options_error` filter** — runs right after that
    validation, once per distinct selection, so a companion plugin can add
    a restriction of its own:
    `apply_filters( 'fair_events_signup_options_error', $error, $ticket_option_ids, $config_event_date_id, $ticket_type_id, $participant_token, $event_date_id )`,
    where `$error` is fair-events' own result (`null` when the selection is
    valid), `$ticket_option_ids` is one ticket's sanitized (deduped, capped
    at 50) selection, `$config_event_date_id` is the series-master-resolved
    event date and `$event_date_id` is the occurrence bought. Returning a
    `WP_Error` rejects the signup. No consumer in this repository.
-   **`fair_events_signup_option_prices` filter** — fair-events builds the
    activity line items itself: one line per activity, its quantity the
    number of tickets that selected it, never folded into the ticket line,
    so the finance ledger names what was bought. An activity priced at zero
    gets no line. Before building them it passes the base prices through
    `apply_filters( 'fair_events_signup_option_prices', $prices, $config_event_date_id, $participant_token )`
    (`$prices` keyed by option ID), so a companion plugin can lower a price
    for a recognised participant. A callback returns the same keys and must
    not add charges of its own — it adjusts prices, fair-events charges
    them. This replaces the former `fair_events_signup_option_line_items`
    filter, which is no longer applied.
-   **`fair_events_signup_created` action** — fires
    `( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id, $participant_token )`
    after a signup row is persisted through the base create path (once per
    row for multi-occurrence signups; `$transaction_id` is `null` on the free
    path). `$ticket_selection` carries `'ticket_type_id'`, `'quantity'`,
    `'ticket_option_ids'` (every activity selected, deduped) and
    `'ticket_activities'` (one list per ticket), or `'event_date_ids'` for
    `'multiple_instances'` types, plus `'mailing_opt_in'` (bool) and
    `'activities_stored'` (true: fair-events already wrote the activities on
    the tickets, so a listener must not attach them again). A companion plugin hooks this to
    create/link its own participant record, set a session cookie, or send its
    own confirmation email — instead of owning a competing create route.
-   **`fair_events_signup_transaction_participant_id` filter** — runs just
    before a paid purchase's, shared series purchase's or base-route retry's
    transaction is created:
    `apply_filters( 'fair_events_signup_transaction_participant_id', null, $signup_ids, $email, $participant_token )`
    (`$participant_token` is `''` on a retry). A positive ID is passed to
    `TransactionAPI::create_transaction()` as `participant_id`, so the
    connector's general email/user lookup (`fair_payment_resolve_participant_id`)
    cannot pick a different participant; `null` (the default) leaves that
    lookup in place. fair-audience returns the participant the signups
    already carry (a retry, and only when they all name the same one), else
    the buyer `link_participant()` is about to resolve — the trusted viewer
    identity, then the participant with the submitted email. A first-time
    buyer has none yet.
-   **`fair_events_signup_transaction_created` action** — fires
    `( $transaction_id, $signup_ids )` once every signup row of a paid
    purchase, shared series purchase or base-route retry is attached to the
    transaction and has had its `fair_events_signup_created` listeners run,
    before payment is initiated. fair-audience
    (`FairAudience\Services\TransactionParticipantLink`) writes the
    transaction's `participant_id` when every signup names the same
    participant — with a conditional update that only fills an empty link,
    so a link set meanwhile is never replaced — and records the transaction
    in its ledger against that participant's registration on each signup's
    date, including one that was already `signed_up`. A transaction already
    linked, or recorded, to another participant is left unchanged. Repeated
    calls are no-ops. Without a listener the transaction stays as the
    connector created it.
-   **`fair_events_signup_confirmed` / `fair_events_signup_payment_failed`
    actions** — `fair-events/src/Hooks/PaymentHooks.php` fires one of these
    per resolved signup row (`$signup, $transaction`) after a
    `fair-payments-connector` webhook flips a base-route signup's `status` to
    `confirmed`/`failed`. `$signup` is the full `fair_events_signups` row
    (status already updated). A companion plugin hooks these to mirror the
    confirmation/failure onto its own operational record (e.g. flipping a
    `pending_payment` relationship to a confirmed label and recording the
    charge) instead of relying solely on its own webhook listener, which
    never sees transactions created through the base route — and, on
    confirmation, to send its own paid-signup confirmation email, since the
    free path's `fair_events_signup_created` listener never sees a paid
    signup's confirmation.
-   **`fair_events_capacity_legacy_admissions` filter** — `TicketCapacity`
    (`fair-events/src/Services/TicketCapacity.php`) counts event-date and
    ticket-type capacity from individual ticket units, and runs
    `apply_filters( 'fair_events_capacity_legacy_admissions', 0, $scope, $id )`
    (`$scope` is `'event_date'` or `'ticket_type'`) to add active admissions
    with no `fair_events_signups` row behind them. fair-audience reports its
    `signed_up` and unexpired `pending_payment` relationships whose
    participant has no signup for the same event date or ticket type, so
    older and hand-added admissions keep their places without being counted
    twice.
-   **`fair_events_capacity_legacy_activity_selections` filter** —
    `TicketCapacity::count_ticket_option()` runs
    `apply_filters( 'fair_events_capacity_legacy_activity_selections', 0, $ticket_option_id, $event_date_id, $series_ids )`
    to add active activity selections not stored on a ticket. fair-audience
    reports participant-level selections not attributed to a ticket, on an
    active relationship, counted on the relationship's date (on every date
    of the series for a whole-series pass).

-   **`fair_events_tickets_deleting` action** — `EventTicket` fires
    `do_action( 'fair_events_tickets_deleting', $ticket_ids )` just before it
    deletes ticket units: positions beyond a reduced quantity
    (`reconcile_signup()`) or every unit of a deleted signup
    (`delete_by_signup_id()`). It also fires right after an administrator
    deletes one cancelled ticket (`mark_deleted()`), whose row stays but is
    hidden for good. It runs inside the caller's transaction, where there is
    one. fair-form detaches the Fair Form answers linked to those tickets
    (see "Fair Form answers per ticket" below).

-   **`fair_events_signup_moved` / `fair_events_signup_ticket_type_changed`
    actions** — `GetTicketsController::update_item()` fires one of these
    after an administrator moved a confirmed signup to another occurrence of
    its series (`$signup, $from_event_date_id`) or gave it another ticket type
    (`$signup, $from_ticket_type_id`). The signup and its units not cancelled
    or refunded on their own have already changed; `$signup` is the updated
    `fair_events_signups` row. fair-audience moves or retypes the
    participant's relationship, unless another active signup of theirs on the
    source date still backs it; a relationship already on the target date is
    kept and the source one removed rather than duplicated.

**`accepted_args` contract.** Register each hook with `accepted_args` matching
what the call site above actually passes — not the callback's own parameter
count, and never a value the callback can't accept. A callback that requires
more arguments than the hook is registered with makes WordPress call it with
too few, throwing `ArgumentCountError` on every dispatch (#1310: two of
`SignupHookBridge`'s filters were registered one argument short, so every
unified-signup submission fatal'd):

| Hook                                  | args passed | `add_filter`/`add_action` call            |
| -------------------------------------- | :---------: | ------------------------------------------ |
| `fair_events_signup_viewer_context`    | 1           | `add_filter( ..., 10, 1 )`                 |
| `fair_events_signup_precheck_error`    | 5           | `add_filter( ..., 10, 5 )` (no consumer)   |
| `fair_events_signup_deferred_response` | 3           | `add_filter( ..., 10, 3 )`                 |
| `fair_events_signup_render_before_form` | 1          | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_render_before_submit` | 1        | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_render_after_form` | 1           | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_ticket_type_error` | 4           | `add_filter( ..., 10, 4 )`                 |
| `fair_events_signup_unit_price`        | 4           | `add_filter( ..., 10, 4 )`                 |
| `fair_events_signup_options_error`     | 6           | `add_filter( ..., 10, 6 )` (no consumer)   |
| `fair_events_signup_option_prices`     | 3           | `add_filter( ..., 10, 3 )`                 |
| `fair_events_signup_transaction_participant_id` | 4  | `add_filter( ..., 10, 4 )`                 |
| `fair_events_signup_created`           | 7           | `add_action( ..., 10, 7 )`                 |
| `fair_events_signup_transaction_created` | 2         | `add_action( ..., 10, 2 )`                 |
| `fair_events_signup_confirmed`         | 2           | `add_action( ..., 10, 2 )`                 |
| `fair_events_signup_payment_failed`    | 2           | `add_action( ..., 10, 2 )`                 |
| `fair_events_backfill_signup_participant_ids` | 0    | `add_action( ... )` (default, no args)     |
| `fair_events_capacity_legacy_admissions` | 3          | `add_filter( ..., 10, 3 )`                 |
| `fair_events_capacity_legacy_activity_selections` | 4 | `add_filter( ..., 10, 4 )`                 |
| `fair_events_tickets_deleting`         | 1           | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_moved`             | 2           | `add_action( ..., 10, 2 )`                 |
| `fair_events_signup_ticket_type_changed` | 2         | `add_action( ..., 10, 1 )` or `2`          |

A registered `accepted_args` may be lower than "args passed" — the callback
just won't receive the trailing ones — but never lower than the callback's own
required-parameter count. `fair-audience/__tests__/Hooks/SignupHookBridgeRegistrationTest.php`
locks this table against `SignupHookBridge::init()` with a reflection check,
so a future hook/registration mismatch fails CI instead of only surfacing as a
500 on the live signup form.

`fair-audience/src/Hooks/SignupHookBridge.php` is the reference consumer:
it hooks `fair_events_signup_created` to link a `Participant`/`EventParticipant`
for the anonymous/linked signup case, and `fair_events_signup_confirmed` /
`fair_events_signup_payment_failed` to flip that `EventParticipant`'s label
and (on confirmation) record the charge in its transaction ledger. It also
hooks `fair_events_signup_option_prices` to apply the viewer's group
discounts to the base activity prices fair-events resolved (the discount
math lives in `fair-audience/src/Services/SignupActivities.php`, mirroring
`GroupSignupPricing.php` from #1242). The selected activities themselves are
written on the purchase's tickets by fair-events (see "Activities and
attendance per ticket" below). The unified block reads a
`participant_token` from the page URL and sends it only through uncached REST
requests. fair-audience validates it before making that identity authoritative
for hydration, restriction checks, pricing, and linkage, and refreshes the
audience session. Invalid supplied tokens resolve anonymously rather than
falling back to another browser identity. A visitor who types the email of
an existing participant without being recognised as them gets a link by
email instead of a signup (`fair_events_signup_deferred_response`, above).
Identity pre-fill, cancel/resignup, per-occurrence signup status and
whole-series passes are all bridged through this contract, no parallel
template.

### Canonical signup store — participant write-back and multiplicity

`fair_events_signups.participant_id` links each purchase record back to the
companion plugin's participant, written by the `fair_events_signup_created`
hook consumer (see `SignupHookBridge::link_participant()`). It is backfilled
on existing rows by the `fair_events_backfill_signup_participant_ids` action,
fired once by the fair-events migration that adds the column and available
for a companion plugin to re-run from its own activation/upgrade path (the
migration may run while that plugin is inactive).

Get-tickets transactions created before their participant link was
written at purchase time are repaired by fair-audience's
`TransactionParticipantRepair`, a batch per request from its upgrade
routine until done (state, with repaired and skipped counts, in the
`fair_audience_transaction_participant_repair` option). It uses only the
signups each transaction's metadata names — including older retries whose
signups have since moved to a newer transaction — and the same
`TransactionParticipantLink` rules, never an email match.

**Signups are many-per-participant-per-event, never one-to-one.** Because
recurring series save "all series" tickets on the master event date, one
participant can legitimately hold multiple signup rows for the same
`event_date_id` (a series pass bought twice, a companion ticket under the
same email, ...). No code may treat "a relationship row already exists" as
"duplicate signup" — always write a fresh `fair_events_signups` row and let
the companion plugin's own operational record (kept unique per
event-date/participant) union the labels instead. The same holds for a
deliberate repeat purchase: every checkout with a new idempotency key creates
its own signup, ticket units, activity selections, answers and — when paid —
transaction, each recorded in the participant's ledger; the relationship
stays one per event date and is never duplicated per ticket. `EventSignup::has_confirmed_signup()`
exists specifically to guard capacity-release cleanups (e.g. an expiry cron)
against dropping a still-valid relationship because of this multiplicity.

### Activities and attendance per ticket

Each individual ticket (`fair_events_tickets`) records its own check-in
(`attended_at`) and activities (`fair_events_ticket_activities`, one row per
ticket option with a name snapshot, a `confirmed`/`pending_payment` status
and an add-on hold expiry). fair-events owns the tables and models
(`EventTicket`, `EventTicketActivity`); fair-audience writes them:

-   **Purchase.** Activities chosen with a get-tickets purchase are confirmed
    on the ticket they were chosen for, in the same transaction that creates
    the tickets and checks capacity. The ticket's own status decides whether
    they count, so a failed or lapsed payment releases them with the ticket.
-   **Add-ons.** `POST fair-audience/v1/event-signup/add-activities` takes an
    optional `ticket_id`. With one confirmed ticket on the date it is used
    automatically; with several, the request must name one (400
    `ticket_required` otherwise). A paid add-on holds the activity on that
    ticket and carries `ticket_id` in the transaction metadata through
    retries and confirmation; the expiry cron releases lapsed holds.
    Participants without tickets (fair-audience's own signup routes) keep
    activities on their relationship, as before.
-   **Admin (#1709).** `GET fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}`
    (`manage_options`) returns what the shared ticket editor
    (`fair-events-shared`'s `TicketEditModal`, opened from both the List and
    Audience tabs) needs: the `ticket` (with `position` within its purchase,
    `participant_name` and `editable`), the `ticket_types` it can take — its
    current type first, then the other enabled types of the event or its
    series master with the same recurrence scope
    (`FairEvents\Services\TicketEditRules`) — each with places left and
    activity rules, and the event's `activities` with places left.
    `PUT` on the same route sets any of the ticket's `ticket_type_id`,
    `activity_ids` and `attended` together, returning 404 for a ticket on
    another event date and 409 `ticket_awaiting_payment` for a ticket that
    is not confirmed. The ticket's type and activity count must keep the
    type's rules (`ticket_type_activities_disabled` / `_exceeded` /
    `_missing`), checked only when the edit changes either. A new type needs
    one place of that type, and only activities the ticket does not already
    hold need a place; every limit the edit would go past is refused at once
    with 409 `capacity_exceeded` carrying `projection` and `projections`,
    unless `override_reason` is given — then the edit is saved, flagged
    (`over_capacity_activity_ids` on the ticket for an activity, the signup's
    `over_capacity`) and recorded in the override audit with the ticket's ID
    and action `change_type` or `activity`. The checks and all writes run in
    one transaction under `TicketCapacity`'s lock, so a refused or failed
    edit changes nothing. Kept activities keep their status (a pending add-on
    hold stays pending); the purchase, its payment and sibling tickets are
    never touched. Checking in again keeps the first time; `attended: false`
    clears it. From then on each ticket's own type is authoritative: the
    signup's `ticket_type_id` stays as purchase history, the List's
    `get-tickets` rows carry each ticket's own type in `tickets`, and the
    signup-wide type change refuses with 409 `ticket_types_individually_edited`
    once a ticket has its own type. The participants list returns each
    participant's `tickets`, and `participant_ticket_option_ids` /
    `attended_at` hold only what is not tied to a ticket.
-   **Assignment (#1535).** Every ticket payload (the single-ticket
    response and each participant's `tickets`) carries `purchaser` and
    `assignee`, each `{ participant_id, name, email }`. The purchaser is the
    ticket's `purchaser_participant_id`, else its signup's participant, else
    the name and email the signup was made with (`participant_id` null); the
    assignee is the holder, or the purchaser while nobody else holds it.
    `POST fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/assign`
    (`manage_options`) takes either `participant_id` or
    `participant: { name, surname, email }` (400 `invalid_assignee` for
    neither or both) and changes only the ticket's `holder_participant_id`
    (`EventTicket::set_holder()`): purchaser, signup, transaction, type,
    activities, answers and sibling tickets stay. It returns the ticket
    payload. Confirmed tickets and tickets awaiting payment can be assigned;
    it refuses 409 `ticket_inactive` (failed, expired, cancelled, refunded),
    409 `ticket_payment_expired` (hold lapsed) and 409 `ticket_checked_in`
    (clear the check-in first). A new participant needs a name
    (400 `participant_name_required`); an email is optional, must be valid
    (400 `invalid_email`) and unused — 409 `email_exists` carries the
    existing one in `data.participant` and creates nothing. It starts on the
    `minimal` email profile. Creating the participant, the holder's
    relationship and the holder change share one transaction, with the ticket
    row locked.

    **Admission follows the ticket held, not the relationship.** A holder
    without a relationship on the date gets one labelled `interested`
    (`EventParticipantRepository::ensure_ticket_holder_relationship()`); an
    existing relationship, and the previous holder's, are never changed. The
    participants list then reports the label that applies: `signed_up` for an
    `interested` relationship holding a confirmed ticket someone else bought,
    and `interested` for a `signed_up` purchaser holding none of the active
    tickets they bought there (`assigned_away_ticket_count` says how many
    others hold).
    Whole-series passes surfaced on occurrences follow the same rule, and a
    signup moved to another date gives its assigned holders a relationship
    there. `count_admissions_without_signup()` skips a relationship whose
    participant holds an active ticket on the date, so a hand-added
    participant given a ticket takes one place. Label-based consumers outside
    the Audience tab (label counts, mailing audiences) still read the stored
    label.
-   **Move, cancel, delete (#1699).** Three `manage_options` routes act on
    one ticket and nothing else: its signup, purchaser, transaction and
    amounts, and the purchase's other tickets, are never written, and none of
    them refunds anything or removes a participant. All return 404
    `ticket_not_found` for a ticket on another event date or a deleted one.
    fair-audience's `TicketOperations` service runs each in one transaction
    with the ticket row locked, so a refused or failed operation changes
    nothing.

    -   `POST …/tickets/{ticket_id}/move` takes `target_event_date_id`: another
        active date of the same recurring event (400 `invalid_target`
        otherwise). Confirmed tickets move, checked in or not, and so do
        tickets awaiting payment while their hold runs (409
        `ticket_payment_expired` after it); a ticket that no longer admits
        anyone is refused with 409 `ticket_inactive`, a whole-series pass
        with 400 `ticket_not_movable`. Only the ticket's `event_date_id`
        changes: type, activities, answers, check-in, purchaser and holder
        stay. The target date needs one place and each activity the ticket
        holds one place there, checked under `TicketCapacity`'s lock; going
        past a limit returns 409 `capacity_exceeded` with `projection` /
        `projections` unless `override_reason` is given, which saves the
        move, flags it and records it in the override audit (action `move`,
        with the ticket's ID).
    -   `POST …/tickets/{ticket_id}/cancel` sets the ticket to `cancelled`
        (409 `ticket_inactive` when it already admits nobody). It releases
        its places and activities at once. The status is final: signup
        transitions, including a payment completed later, never revive it.
    -   `DELETE …/tickets/{ticket_id}` needs a cancelled ticket (409
        `ticket_not_cancelled`) and sets its `deleted_at`. The row stays with
        its position, purchaser and signup, so `reconcile_signup()` never
        fills the position again and the capacity fallback for signups
        without units never counts the signup's quantity. Deleted tickets are
        left out of every admin ticket response.

    **A ticket's date is its own.** It starts on its signup's date and
    follows the signup when that is moved, until it is moved individually:
    from then on a signup move takes along only the tickets still on the
    signup's date. Capacity already counts each ticket on its own date;
    `TicketCapacity::demands_for_signup()` describes a signup's tickets per
    date and type for late confirmations and retries, leaving out tickets
    cancelled on their own.

    **Relationships follow the tickets.** The holder of a moved ticket gets a
    relationship on the target date (`ensure_ticket_admission()`): `signed_up`
    for a purchaser holding their own confirmed ticket — an `interested` one
    is raised to it — and the assigned-ticket rule otherwise. A purchaser left
    with no active ticket they hold or bought on a date goes from `signed_up`
    or `pending_payment` to `interested` (`reconcile_ticket_admission()`), so
    they stay listed with their identity, consent, comment and history but
    are no longer admitted; a collaborator keeps that role. The same two
    steps run after a late payment confirmation
    (`TicketOperations::follow_signup_confirmation()`), for tickets moved or
    cancelled while the purchase was awaiting payment.

    The participants list returns the cancelled, not deleted tickets each
    participant holds as `cancelled_tickets`, apart from `tickets`, which
    stay the tickets that admit them. Every ticket payload carries its
    `event_date_id` and `whole_series`.
-   **History.** Participant-level activities and check-ins recorded before
    this change are copied onto a ticket by `TicketHistoryBackfill` only when
    the participant held exactly one ticket on that date; the originals are
    kept and marked (`ticket_id` on the option row, `attended_ticket_id` on
    the relationship). Anything else stays at participant scope.
-   **Capacity (#1697).** `TicketCapacity::count_ticket_option( $option_id, $event_date_id )`
    counts one place per active ticket selecting the activity on that
    occurrence — sibling tickets of one purchase take one each — plus
    unresolved participant-level selections (see
    `fair_events_capacity_legacy_activity_selections`). A selection is active
    while its ticket holds its places and the selection is confirmed or an
    unexpired add-on hold. An activity's limit, configured on the series
    master, applies to each occurrence separately; a whole-series ticket's
    selection takes a place on every occurrence it covers.
    `count_signups_for_ticket_option( $option_id, $event_date_id )` delegates
    to it. Purchases, add-ons (free and paid, including retries), admin
    ticket edits, admin moves and late confirmations all check activity
    places under `TicketCapacity`'s lock, which takes event-date, ticket-type
    and activity rows in that order. A move to a date where an activity is
    full returns 409 `capacity_exceeded` with the activity's projection and
    accepts `override_reason`; a ticket-type change is refused (409
    `ticket_type_activities_disabled` / `_exceeded` / `_missing`) when a
    ticket's activities break the new type's rules. A late paid purchase or
    add-on is honored and flagged over capacity when its places were taken.
    A failed add-on payment releases that ticket's hold at once.

### Fair Form answers per ticket

A Fair Form submission collected during a get-tickets signup records the
ticket it belongs to (`ticket_id` and `ticket_link` on
`fair_audience_questionnaire_submissions`, #1609). fair-form owns the columns
and `FairForm\Services\TicketAnswers` (the read side); fair-events and
fair-audience call it behind `class_exists()` guards.

-   **Write.** A signup still collects one answer set. `GetTicketsController`
    passes the purchase's first ticket (lowest `unit_position`, looked up from
    the signup it just saved — never from the request) to
    `QuestionnaireService::save_answers()`, which reuses a submission by
    ticket, so a later purchase by the same participant never replaces an
    earlier one's answers. `ticket_link` is `direct`. Submissions with no
    ticket (standalone Fair Form blocks, fair-audience's own signup routes)
    keep `ticket_id` and `ticket_link` NULL.
-   **Read.** The admin `get-tickets` list with `include_answers` puts
    `answers` on each ticket and repeats the first ticket's on the signup
    (`answers_ticket_id`, `answers_need_review`). fair-audience's participant
    list and ticket endpoint return each ticket's `answers`; the participant's
    `questionnaire_answers` hold only answers not attached to a ticket.
    `fair-form/v1/questionnaire-responses` returns `ticket_id`, `ticket_link`
    and `needs_review`.
-   **Legacy.** `SubmissionTicketBackfill` attaches submissions that predate
    the link, once fair-events' ticket units are complete: the earliest
    signup of the same participant on the same event date, its first ticket,
    marked `inferred`. With no match — or when that ticket already has a
    submission — it is marked `unresolved` and stays at participant scope.
    Standalone submissions (a `form_id`, or titled "Fair Form" / "Audience
    Signup") are left alone.
-   **Removal.** When a linked ticket is deleted (`fair_events_tickets_deleting`),
    the submission keeps its answers, loses its `ticket_id` and is marked
    `ticket_removed`; it is never moved to another ticket.

`inferred`, `unresolved` and `ticket_removed` links are flagged for review in
the admin views.

## Related Documentation

-   [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend implementation guide

## External Resources

-   [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/)
-   [WP_REST_Controller Reference](https://developer.wordpress.org/reference/classes/wp_rest_controller/)
-   [REST API Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
-   [Security Best Practices](https://developer.wordpress.org/plugins/security/)
