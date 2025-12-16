# PHP Patterns for Fair Event Plugins

Reusable PHP patterns and best practices for WordPress plugin development in this monorepo.

## Database Query Patterns

### Using `wpdb::prepare()` with Table Names

**IMPORTANT**: Always use `wpdb::prepare()` with the `%i` identifier placeholder for table and column names to prevent SQL injection.

#### Basic Pattern

```php
<?php
global $wpdb;

$table_name = $wpdb->prefix . 'fair_groups';

$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM %i WHERE status = %s ORDER BY name ASC",
        $table_name,
        'active'
    ),
    ARRAY_A
);
```

#### Available Placeholders

| Placeholder | Type | Use For | Example |
|-------------|------|---------|---------|
| `%i` | Identifier | Table names, column names | `%i`, `WHERE %i = %s` |
| `%s` | String | Text values | `'active'`, `'John Doe'` |
| `%d` | Integer | Whole numbers | `42`, `123` |
| `%f` | Float | Decimal numbers | `3.14`, `99.99` |
| `%%` | Literal | Escape percentage sign | `LIKE '%%example%%'` |

#### Multiple Identifiers and Values

```php
<?php
$table_name = $wpdb->prefix . 'fair_memberships';
$column = 'user_id';
$status = 'active';
$min_id = 100;

$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM %i WHERE %i = %d AND status = %s",
        $table_name,
        $column,
        $min_id,
        $status
    )
);
```

#### Using ORDER BY with Column Names

```php
<?php
$table_name = $wpdb->prefix . 'fair_events';
$order_column = 'created_at';

$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM %i WHERE status = %s ORDER BY %i DESC",
        $table_name,
        'published',
        $order_column
    )
);
```

#### **CRITICAL**: Always Call `prepare()` Directly Inside Query Methods

**IMPORTANT**: To avoid PHP CodeSniffer lint errors (`WordPress.DB.PreparedSQL.NotPrepared`), always call `$wpdb->prepare()` **directly inside** the query method call. Never store the prepared query in a variable first.

**Why?** The WordPress Coding Standards linter can only detect that a query is safe when it sees `$wpdb->prepare()` called directly. When you store the prepared query in a variable, the linter sees only the variable being passed and flags it as potentially unsafe.

```php
<?php
global $wpdb;
$table_name = $wpdb->prefix . 'fair_groups';

// ❌ WRONG - Prepare in variable first (triggers lint error)
$query = $wpdb->prepare(
    'SHOW TABLES LIKE %s',
    $table_name
);
$exists = $wpdb->get_var( $query ) === $table_name;

// ✅ CORRECT - Prepare directly inside query method
$exists = $wpdb->get_var(
    $wpdb->prepare(
        'SHOW TABLES LIKE %s',
        $table_name
    )
) === $table_name;
```

**More Examples:**

```php
<?php
// ❌ WRONG - Variable storage
$query = $wpdb->prepare(
    "SELECT * FROM %i WHERE status = %s",
    $table_name,
    'active'
);
$results = $wpdb->get_results( $query );

// ✅ CORRECT - Inline prepare
$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM %i WHERE status = %s",
        $table_name,
        'active'
    )
);
```

```php
<?php
// ❌ WRONG - Variable storage
$count_query = $wpdb->prepare(
    "SELECT COUNT(*) FROM %i WHERE status = %s",
    $table_name,
    'pending'
);
$count = $wpdb->get_var( $count_query );

// ✅ CORRECT - Inline prepare
$count = $wpdb->get_var(
    $wpdb->prepare(
        "SELECT COUNT(*) FROM %i WHERE status = %s",
        $table_name,
        'pending'
    )
);
```

**Key Rule**: If you're calling `$wpdb->prepare()`, pass the result **directly** to the query method (`get_results()`, `get_var()`, `get_row()`, `query()`, etc.) in the same statement.

#### JOIN Queries with Multiple Tables

```php
<?php
$memberships_table = $wpdb->prefix . 'fair_memberships';
$groups_table = $wpdb->prefix . 'fair_groups';
$user_id = 123;

$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT m.*, g.name as group_name
         FROM %i AS m
         INNER JOIN %i AS g ON m.group_id = g.id
         WHERE m.user_id = %d",
        $memberships_table,
        $groups_table,
        $user_id
    )
);
```

#### INSERT with wpdb::insert()

```php
<?php
$table_name = $wpdb->prefix . 'fair_groups';

$wpdb->insert(
    $table_name,
    array(
        'name' => 'New Group',
        'status' => 'active',
        'created_at' => current_time( 'mysql' ),
    ),
    array(
        '%s',  // name
        '%s',  // status
        '%s',  // created_at
    )
);
```

#### UPDATE with wpdb::update()

```php
<?php
$table_name = $wpdb->prefix . 'fair_memberships';

$wpdb->update(
    $table_name,
    array(
        'status' => 'inactive',
        'ended_at' => current_time( 'mysql' ),
    ),
    array(
        'id' => 42,
    ),
    array(
        '%s',  // status
        '%s',  // ended_at
    ),
    array(
        '%d',  // id
    )
);
```

#### Array of Values (IN Clause)

```php
<?php
$table_name = $wpdb->prefix . 'fair_groups';
$group_ids = array( 1, 2, 3, 5, 8 );

// Create placeholders for each ID
$placeholders = implode( ', ', array_fill( 0, count( $group_ids ), '%d' ) );

// Merge table name and values
$prepare_values = array_merge( array( $table_name ), $group_ids );

$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM %i WHERE id IN ( $placeholders )",
        $prepare_values
    )
);
```

### What NOT to Use

#### ❌ NEVER store prepared queries in variables before executing

```php
<?php
// ❌ WRONG - Triggers phpcs lint error
$query = $wpdb->prepare(
    'SELECT * FROM %i WHERE id = %d',
    $table_name,
    $id
);
$result = $wpdb->get_row( $query );

// ✅ CORRECT - Inline prepare call
$result = $wpdb->get_row(
    $wpdb->prepare(
        'SELECT * FROM %i WHERE id = %d',
        $table_name,
        $id
    )
);
```

**Why?** PHP CodeSniffer cannot trace that the `$query` variable is safe. It only recognizes `$wpdb->prepare()` when called directly inside the query method.

#### ❌ NEVER use `esc_sql()` for table/column names

```php
<?php
// ❌ WRONG - Still vulnerable to SQL injection
$table_name = esc_sql( $wpdb->prefix . 'fair_groups' );
$wpdb->get_results( "SELECT * FROM {$table_name}" );
```

**Why?** `esc_sql()` only escapes values within quotes, NOT identifiers like table/column names.

#### ❌ NEVER interpolate variables directly

```php
<?php
// ❌ WRONG - Vulnerable to SQL injection
$table_name = $wpdb->prefix . 'fair_groups';
$status = $_GET['status'];
$wpdb->get_results( "SELECT * FROM {$table_name} WHERE status = '{$status}'" );
```

### Requirements (WordPress 6.2+)

The `%i` identifier placeholder was introduced in **WordPress 6.2**. This project requires WordPress 6.7+, so `%i` is always available.

### References

- [wpdb::prepare() Official Documentation](https://developer.wordpress.org/reference/classes/wpdb/prepare/)
- [esc_sql() Limitations](https://developer.wordpress.org/reference/functions/esc_sql/)
- [WordPress Plugin Security: Common Issues](https://developer.wordpress.org/plugins/wordpress-org/common-issues/)

## Additional PHP Patterns

### Security: Prevent Direct File Access

Always include at the top of every PHP file:

```php
<?php
/**
 * File description
 *
 * @package PluginName
 */

namespace PluginName\Path;

defined( 'WPINC' ) || die;
```

### PSR-4 Autoloading

**Namespace to Directory Mapping**:
- Namespace: `FairMembership\API\MembershipController`
- File path: `fair-membership/src/API/MembershipController.php`

**Rules**:
- Use uppercase for acronyms in directories: `src/API/` (not `src/Api/`)
- Match namespace casing exactly to directory names
- Case-sensitive on Linux (production) even though macOS (development) is case-insensitive

### Nonce Verification

```php
<?php
// Verify nonce for form submissions
if ( ! isset( $_POST['my_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['my_nonce'] ) ), 'my_action' ) ) {
    wp_die( esc_html__( 'Security check failed', 'plugin-slug' ) );
}
```

### Sanitizing User Input

```php
<?php
// Text fields
$name = sanitize_text_field( wp_unslash( $_POST['name'] ) );

// Textarea
$description = sanitize_textarea_field( wp_unslash( $_POST['description'] ) );

// Email
$email = sanitize_email( wp_unslash( $_POST['email'] ) );

// Integer
$user_id = absint( $_POST['user_id'] );

// Array of integers
$ids = array_map( 'absint', (array) $_POST['ids'] );
```

### Escaping Output

```php
<?php
// HTML content
echo esc_html( $text );

// HTML attributes
echo '<div class="' . esc_attr( $class ) . '">';

// URLs
echo '<a href="' . esc_url( $url ) . '">';

// JavaScript strings
echo '<script>var name = "' . esc_js( $name ) . '";</script>';

// Translated and escaped
esc_html_e( 'Settings page', 'plugin-slug' );
echo esc_html__( 'Settings page', 'plugin-slug' );
```

### Debugging and Logging

**IMPORTANT**: Always wrap `error_log()` calls in a `WP_DEBUG` check. Never leave debug logging active in production code.

#### Safe Error Logging Pattern

**Option 1: Inline with WP_DEBUG check and phpcs suppression**

```php
<?php
// Simple message
if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
    // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
    error_log( 'Debug message: Something happened' );
}

// Logging arrays or objects
if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
    // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
    error_log( print_r( $my_array, true ) );
}
```

**Option 2: Helper function with phpcs suppression**

```php
<?php
// Helper function for consistent logging
function my_plugin_debug_log( $message ) {
    if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
        // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
        if ( is_array( $message ) || is_object( $message ) ) {
            error_log( print_r( $message, true ) );
        } else {
            error_log( $message );
        }
    }
}

// Usage
my_plugin_debug_log( 'User action performed' );
my_plugin_debug_log( $user_data );
```

**Option 3: Recommended - Use DebugLogger utility class**

For cleaner code and centralized phpcs suppression, use a dedicated utility class:

```php
<?php
use FairMembership\Utils\DebugLogger;

// Simple message
DebugLogger::log( 'User action performed' );

// Array or object (automatically formatted)
DebugLogger::log( $user_data );

// With custom prefix
DebugLogger::log( 'Processing payment', 'PAYMENT' );

// Using convenience methods
DebugLogger::error( 'Payment failed: Invalid card' );
DebugLogger::warning( 'Rate limit approaching' );
DebugLogger::info( 'Cache cleared successfully' );

// With context
DebugLogger::log_with_context(
    'Database migration failed',
    array(
        'table'   => 'fair_groups',
        'version' => '1.2.0',
        'error'   => $wpdb->last_error,
    )
);
```

**Benefits of DebugLogger utility:**
- Single phpcs suppression in one place
- Automatic WP_DEBUG check (no manual wrapping needed)
- Consistent formatting for arrays/objects
- Semantic methods (error, warning, info)
- Zero production impact

See `fair-membership/src/Utils/DebugLogger.php` for the implementation.

#### What NOT to Use

```php
<?php
// ❌ WRONG - Unconditional logging in production
error_log( 'Debug message' );

// ❌ WRONG - Modifying error reporting in plugin code
error_reporting( E_ALL );
ini_set( 'display_errors', 1 );
```

**Why?**

- Unconditional `error_log()` calls run in production and can fill logs with debug messages
- Modifying `error_reporting()` or `ini_set()` in plugins interferes with site-wide debugging configuration
- Debug logs can contain sensitive information and should only be used in development

#### Recommended wp-config.php Setup

**Development/Staging:**
```php
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );      // Logs to wp-content/debug.log
define( 'WP_DEBUG_DISPLAY', false ); // Don't show errors on screen
define( 'SCRIPT_DEBUG', true );      // Use unminified JS/CSS
```

**Production:**
```php
define( 'WP_DEBUG', false );
```

#### References

- [Debugging in WordPress – Advanced Administration Handbook](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/)
- [WordPress Plugin Security: Common Issues](https://developer.wordpress.org/plugins/wordpress-org/common-issues/)

## Code Quality Standards

### User Should Run After Changes

**IMPORTANT**: After making code changes, users should run:

```bash
npm run format    # Format all code (JavaScript, CSS, PHP)
```

**For Claude Code**: Do NOT automatically run formatting tools. Prompt the user to run `npm run format` after completing code changes.

### PHP Coding Standards

```bash
cd fair-plugin-name
vendor/bin/phpcs  # Check PHP code style
```

## See Also

- [CLAUDE.md](./CLAUDE.md) - Main project documentation
- [REST_API_BACKEND.md](./REST_API_BACKEND.md) - REST API security patterns
- [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend API usage patterns
- [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md) - React admin page patterns
- [TESTING.md](./TESTING.md) - Testing architecture and patterns
