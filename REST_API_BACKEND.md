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

## Related Documentation

-   [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend implementation guide

## External Resources

-   [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/)
-   [WP_REST_Controller Reference](https://developer.wordpress.org/reference/classes/wp_rest_controller/)
-   [REST API Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
-   [Security Best Practices](https://developer.wordpress.org/plugins/security/)
