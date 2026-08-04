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
    (`GET fair-events/v1/get-tickets/viewer-context?event_date_id=…`,
    `permission_callback: __return_true` — safe because the route carries no
    identity parameter; the viewer is resolved purely server-side from the
    session cookie/login, same as the public
    `/fair-audience/v1/event-signup/status` endpoint), never by the render a
    full-page cache stores. frontend.js calls this endpoint after load for
    every page view — cached or not — and patches the response into the DOM,
    so the visible result never depends on who the page happened to be
    rendered for. The endpoint rebuilds the same-shaped context as
    `fair_events_signup_render_context` above, but *unfiltered* (including
    group-restricted tiers), plus a `viewer_resolved` key (`false` by
    default). A companion plugin sets `viewer_resolved = true` whenever it
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
    `occurrences_signed_up` (event_date_ids), `prefill_name`, `prefill_email`.
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
    `[ id, name, short_name, price, is_full ]` (empty unless both
    `fair-events-experimental`'s activity catalogue and fair-audience — the
    only consumer that can persist a selection — are active); fair-audience's
    `SignupHookBridge::enrich_render_context()` overrides each option's
    `price`/`is_full` with participant-aware resolution (group discount,
    live capacity) and, for a recognised viewer already signed up for this
    event date, adds `addable_options` (options they don't already have) and
    `current_activity_names`. `minimum_activities` is the event-date global
    requirement, capped at `count( $ticket_options )`; a ticket type can raise
    it further via its own `minimum_activities` property — see
    `frontend.js`' `getEffectiveActivityMinimum()`.
-   **`fair_events_signup_precheck_error` filter** — `GetTicketsController::create_signup()`
    runs this immediately after the event date is validated, before ticket-type
    or options validation, so it covers the single-, `multiple_instances`- and
    no-ticket-type paths alike:
    `apply_filters( 'fair_events_signup_precheck_error', null, $event_date_id, $email, $ticket_type_id )`.
    Returning a `WP_Error` rejects the signup. fair-audience scopes this to a
    duplicate *ticket* purchase only: when the request carries a
    `$ticket_type_id` and the recognised viewer already holds a `signed_up`
    relationship for this event date with a ticket type attached, it returns
    409 `already_signed_up` — this is a guard against a resubmitted/
    double-clicked ticket purchase writing a second row (and, on a paid tier,
    charging again), not a one-signup-per-participant rule. A `$ticket_type_id`
    of `0` (no ticket type — activity-only or a companion signup) or a
    `pending_payment` relationship (an incomplete payment, not a genuine
    repeat) is never rejected here, matching the "Canonical signup store"
    multiplicity below. `null` (the default) allows the signup to proceed.
-   **`fair_events_signup_ticket_type_error` filter** — `GetTicketsController::create_signup()`
    runs this right after a submitted ticket type is validated and confirmed
    not disabled: `apply_filters( 'fair_events_signup_ticket_type_error', null, $ticket_type_id, $event_date_id )`.
    Returning a `WP_Error` rejects the signup with that error (fair-audience
    returns a 403 `ticket_type_restricted` when the ticket type is
    group-restricted and the viewer isn't a member); returning `null` (the
    default) allows the signup to proceed. Runs once before either the
    single- or `multiple_instances` path dispatches, so it covers both.
-   **`fair_events_signup_unit_price` filter** — runs immediately after
    `TicketPricing::resolve_unit_price()` in both `create_signup()` and
    `create_multi_instance_signup()`: `apply_filters( 'fair_events_signup_unit_price', $unit_price, $ticket_type_id, $event_date_id )`.
    A companion plugin uses this to apply participant-specific discounts (e.g.
    a group pricing rule) on top of the base price; `$unit_price` is `null`
    when no active sale period configures one, which a filter callback should
    pass through unchanged. This is a dedicated seam rather than the
    pre-existing `fair_events_resolve_ticket_price` filter (which is also the
    base price inside `EventSignupPricing::resolve_price_for_ticket_type()` —
    hooking it here would double-discount that path).
-   **`fair_events_signup_options_error` filter** — `GetTicketsController::create_signup()`
    runs this once, unconditionally (outside the `if ( $ticket_type_id )`
    block, so a global minimum-activities requirement still applies to a
    signup with no ticket type):
    `apply_filters( 'fair_events_signup_options_error', null, $ticket_option_ids, $config_event_date_id, $ticket_type_id )`,
    where `$ticket_option_ids` is the sanitized (deduped, capped at 50)
    submitted array and `$config_event_date_id` is the series-master-resolved
    event date the ticket-type validation above already computed. Returning a
    `WP_Error` rejects the signup (fair-audience returns 400
    `invalid_ticket_option` for an ID that doesn't belong to the event date,
    409 `ticket_option_full` naming the activity when it has no capacity
    left, or 400 `minimum_activities_not_met` when the selection is short);
    `null` (the default) allows the signup to proceed.
-   **`fair_events_signup_option_line_items` filter** — runs immediately
    after the filter above, once validation passed:
    `apply_filters( 'fair_events_signup_option_line_items', array(), $ticket_option_ids, $config_event_date_id )`.
    A companion plugin resolves each selected option to a priced line item
    (`[ 'name', 'quantity', 'amount' ]`, participant discounts applied);
    `create_signup()` sums them into `$amount` and appends them to the paid
    transaction's line items as their own entries — never folded into the
    ticket line — so the finance ledger names what was bought. Quantity is
    forced to 1 server-side (and client-side) whenever any activity is
    selected, since activities attach to a single `EventParticipant` row.
-   **`fair_events_signup_created` action** — fires
    `( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id )`
    after a signup row is persisted through the base create path (once per
    row for multi-occurrence signups; `$transaction_id` is `null` on the free
    path). `$ticket_selection` carries `'ticket_type_id'`, `'quantity'`,
    `'ticket_option_ids'` (or `'event_date_ids'` for `'multiple_instances'`
    types), and `'mailing_opt_in'` (bool). A companion plugin hooks this to
    create/link its own participant record, set a session cookie, or send its
    own confirmation email — instead of owning a competing create route.
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
| `fair_events_signup_precheck_error`    | 4           | `add_filter( ..., 10, 4 )`                 |
| `fair_events_signup_render_before_form` | 1          | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_render_before_submit` | 1        | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_render_after_form` | 1           | `add_action( ..., 10, 1 )`                 |
| `fair_events_signup_ticket_type_error` | 3           | `add_filter( ..., 10, 2 )` or `3`          |
| `fair_events_signup_unit_price`        | 3           | `add_filter( ..., 10, 2 )` or `3`          |
| `fair_events_signup_options_error`     | 4           | `add_filter( ..., 10, 4 )`                 |
| `fair_events_signup_option_line_items` | 3           | `add_filter( ..., 10, 3 )`                 |
| `fair_events_signup_created`           | 6           | `add_action( ..., 10, 6 )`                 |
| `fair_events_signup_confirmed`         | 2           | `add_action( ..., 10, 2 )`                 |
| `fair_events_signup_payment_failed`    | 2           | `add_action( ..., 10, 2 )`                 |
| `fair_events_backfill_signup_participant_ids` | 0    | `add_action( ... )` (default, no args)     |

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
hooks `fair_events_signup_options_error` / `fair_events_signup_option_line_items`
(delegating the actual validation/pricing logic to
`fair-audience/src/Services/SignupActivities.php`, mirroring
`GroupSignupPricing.php` from #1242) and, once `link_participant()` creates or
finds the `EventParticipant` row, attaches the selected `ticket_option_ids`
via `EventParticipantRepository::add_options()`. `participant_token` URL login
and the "I have an account" / request-link prompt still go through
`fair-audience/v1`'s own routes (deferred to a follow-up ticket at the #1245
cutover) — everything else (identity pre-fill, cancel/resignup, per-occurrence
signup status, whole-series passes) is bridged through this contract, no
parallel template.

### Canonical signup store — participant write-back and multiplicity

`fair_events_signups.participant_id` links each purchase record back to the
companion plugin's participant, written by the `fair_events_signup_created`
hook consumer (see `SignupHookBridge::link_participant()`). It is backfilled
on existing rows by the `fair_events_backfill_signup_participant_ids` action,
fired once by the fair-events migration that adds the column and available
for a companion plugin to re-run from its own activation/upgrade path (the
migration may run while that plugin is inactive).

**Signups are many-per-participant-per-event, never one-to-one.** Because
recurring series save "all series" tickets on the master event date, one
participant can legitimately hold multiple signup rows for the same
`event_date_id` (a series pass bought twice, a companion ticket under the
same email, ...). No code may treat "a relationship row already exists" as
"duplicate signup" — always write a fresh `fair_events_signups` row and let
the companion plugin's own operational record (kept unique per
event-date/participant) union the labels instead. `EventSignup::has_confirmed_signup()`
exists specifically to guard capacity-release cleanups (e.g. an expiry cron)
against dropping a still-valid relationship because of this multiplicity.

## Related Documentation

-   [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend implementation guide

## External Resources

-   [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/)
-   [WP_REST_Controller Reference](https://developer.wordpress.org/reference/classes/wp_rest_controller/)
-   [REST API Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
-   [Security Best Practices](https://developer.wordpress.org/plugins/security/)
