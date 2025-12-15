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

## Code Quality Standards

### Always Run After Changes

```bash
npm run format    # Format all code (JavaScript, CSS, PHP)
```

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
