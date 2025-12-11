# REST API Backend Standards for Fair Event Plugins

This document defines security standards and best practices for implementing WordPress REST API endpoints in Fair Event Plugins.

## Security Audit Summary

**Status**: 🟡 **TODO Items for Enhancement**

### Issues Found

| Plugin | Endpoint | Issue | Severity |
|--------|----------|-------|----------|
| fair-payment | `/payments` | `permission_callback => __return_true` - Intentionally public but needs different handling for logged-in vs anonymous | 🟡 **TODO** |
| fair-payment | `/webhook` | `permission_callback => __return_true` - Appropriate for webhooks but needs signature validation | 🟡 **MEDIUM** |
| fair-registration | `/registrations` | `return true` - Open endpoint with TODO comment about nonce | 🟡 **TODO** |
| **ALL plugins** | All endpoints | **Nonce verification handled automatically by WordPress when using `apiFetch()`** | ✅ **OK** |

### Good Patterns Found

✅ **fair-rsvp**: Uses `WP_REST_Controller` base class with custom permission callbacks
✅ **fair-membership**: Consistent `check_permission()` method checking `manage_options`
✅ **fair-rsvp**: Checks `is_user_logged_in()` for user-specific endpoints

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

All REST API controllers SHOULD extend `WP_REST_Controller`:

```php
<?php
namespace PluginName\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

class MyController extends WP_REST_Controller {

    protected $namespace = 'plugin-name/v1';
    protected $rest_base = 'items';

    public function register_routes() {
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
    }

    public function get_items_permissions_check( $request ) {
        return is_user_logged_in();
    }

    public function create_item_permissions_check( $request ) {
        return current_user_can( 'edit_posts' );
    }

    // ... implement methods
}
```

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

## Action Items: Enhancement TODOs

### HIGH Priority

1. **fair-payment/PaymentEndpoint.php:69** - Differentiate logged-in vs anonymous users
   ```php
   // Current: Treats all users the same
   public function create_payment( WP_REST_Request $request ) {
       // ...
       $user_id = get_current_user_id(); // Could be 0 for anonymous
   }

   // TODO: Add different behavior for logged-in vs anonymous users
   // - Logged-in users: Associate payment with user account, apply member benefits
   // - Anonymous users: Allow payment but require email, no member benefits
   // Example:
   public function create_payment( WP_REST_Request $request ) {
       $user_id = get_current_user_id();

       if ( $user_id ) {
           // Logged-in user: Apply member discounts, track in user profile
           $amount = $this->apply_member_discount( $amount, $user_id );
           // Store user-specific metadata
       } else {
           // Anonymous user: Require email, no discounts
           $email = $request->get_param( 'email' );
           if ( empty( $email ) || ! is_email( $email ) ) {
               return new WP_Error( 'email_required', 'Email required for anonymous payments' );
           }
       }
   }
   ```

2. **fair-registration/RegistrationsController.php:204-208** - Document nonce handling
   ```php
   // Current:
   public function create_registration_permissions_check( $request ) {
       // Allow anyone to create registrations (public endpoint)
       // In production, you might want to add nonce verification or other security measures
       return true;
   }

   // Update comment to:
   public function create_registration_permissions_check( $request ) {
       // Public endpoint - allows anonymous registrations
       // Nonce verification is automatically handled by WordPress REST API when using apiFetch()
       // Frontend MUST use apiFetch() from @wordpress/api-fetch for nonce to be sent
       return true;
   }
   ```

### MEDIUM Priority

3. **fair-payment/WebhookEndpoint.php** - Add webhook signature verification
   - Research Mollie webhook signature verification
   - Implement signature validation in `handle_webhook()`
   - See: https://docs.mollie.com/overview/webhooks

### Documentation Tasks

4. Update CLAUDE.md to reference this document
5. Add security checklist to REST API integration section
6. Create code review checklist for pull requests

---

## Testing REST API Security

### Manual Testing

```bash
# Test without authentication (should fail for protected endpoints)
curl -X POST http://localhost:8080/wp-json/fair-payment/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"amount":"10.00","currency":"EUR"}'

# Test with valid nonce (should succeed)
# Get nonce from browser console: wp.apiFetch.nonceMiddleware.nonce
curl -X POST http://localhost:8080/wp-json/fair-payment/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-WP-Nonce: YOUR_NONCE_HERE" \
  -H "Cookie: YOUR_COOKIES_HERE" \
  -d '{"amount":"10.00","currency":"EUR"}'
```

### Automated Testing

See [REST_API_USAGE.md#testing-strategy](./REST_API_USAGE.md#testing-strategy-for-rest-api-calls) for PHP integration tests that can verify:
- Permission callbacks work correctly
- Unauthorized requests return 401/403
- Valid requests succeed
- Nonce verification functions

---

## Resources

- [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/)
- [WP_REST_Controller Reference](https://developer.wordpress.org/reference/classes/wp_rest_controller/)
- [REST API Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Security Best Practices](https://developer.wordpress.org/plugins/security/)
