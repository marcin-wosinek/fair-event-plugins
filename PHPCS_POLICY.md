# PHP CodeSniffer (PHPCS) Policy and Strategy

## Overview

This document defines our policy for handling WordPress Coding Standards violations, particularly for database queries and when to use `phpcs:ignore` comments.

## Core Principles

1. **Security First**: Never ignore actual security vulnerabilities
2. **Standards Compliance**: Follow WordPress Coding Standards where practical
3. **PSR-4 Over WordPress File Naming**: We use PSR-4 autoloading, so WordPress file naming conventions don't apply
4. **Document Exceptions**: When using `phpcs:ignore`, add comments explaining why it's safe

## Database Query Standards

### Critical Rules (NEVER Ignore Without Justification)

These rules prevent SQL injection and must be addressed:

- `WordPress.DB.PreparedSQL.NotPrepared` - Missing or improperly used `$wpdb->prepare()`
- `WordPress.DB.PreparedSQL.InterpolatedNotPrepared` - Variable interpolation in SQL without proper escaping

### Solution Strategy for Table Names

**Problem**: WordPress coding standards flag table names with prefixes as unsafe when interpolated.

**Solution**: Use `esc_sql()` + separate SQL variable + `phpcs:ignore` comment

```php
// ✅ CORRECT - Escaped table name with phpcs:ignore
$table_name = esc_sql( $wpdb->prefix . 'fair_groups' );
$sql        = "SELECT * FROM {$table_name} WHERE id = %d";
$result     = $wpdb->get_row(
    $wpdb->prepare( $sql, $id ), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    ARRAY_A
);
```

**Why this is safe**:
- Table name is escaped with `esc_sql()` (prevents SQL injection)
- User input (`$id`) is properly prepared with `%d` placeholder
- The `phpcs:ignore` only suppresses the warning about the SQL variable, not actual vulnerabilities

**When to use this pattern**:
- Any query with dynamic table names (prefix + table name)
- SELECT, UPDATE, DELETE, INSERT queries with table name interpolation

### What NOT to do

```php
// ❌ WRONG - Direct interpolation without escaping
$table_name = $wpdb->prefix . 'fair_groups';
$result = $wpdb->get_row( "SELECT * FROM {$table_name} WHERE id = {$id}" );

// ❌ WRONG - Using phpcs:ignore to hide actual vulnerabilities
$result = $wpdb->get_row(
    "SELECT * FROM {$table_name} WHERE id = {$id}" // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
);

// ❌ WRONG - Forgetting to prepare user input
$result = $wpdb->get_row(
    "SELECT * FROM {$table_name} WHERE slug = '{$slug}'" // Still vulnerable even with esc_sql on table name
);
```

### Complex Queries with Dynamic Parts

For queries with conditional clauses (WHERE, ORDER BY, LIMIT):

```php
// ✅ CORRECT - Build query parts separately
$table_name = esc_sql( $wpdb->prefix . 'fair_groups' );
$where_conditions = array();
$where_values     = array();

if ( ! is_null( $args['status'] ) ) {
    $where_conditions[] = 'status = %s';
    $where_values[]     = $args['status'];
}

$where_clause = ! empty( $where_conditions ) ? 'WHERE ' . implode( ' AND ', $where_conditions ) : '';
$order_clause = sprintf( 'ORDER BY %s %s', esc_sql( $args['orderby'] ), esc_sql( $args['order'] ) );

$sql = "SELECT * FROM {$table_name} {$where_clause} {$order_clause}";

if ( ! empty( $where_values ) ) {
    // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    $results = $wpdb->get_results( $wpdb->prepare( $sql, $where_values ), ARRAY_A );
} else {
    // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    $results = $wpdb->get_results( $sql, ARRAY_A );
}
```

## File Naming Conventions

### Expected Warnings (Acceptable)

Our codebase uses PSR-4 autoloading, which conflicts with WordPress file naming standards:

```
1 | ERROR | Filenames should be all lowercase with hyphens as word
  |       | separators. Expected group.php, but found Group.php.
1 | ERROR | Class file names should be based on the class name with
  |       | "class-" prepended. Expected class-group.php, but found Group.php.
```

**Policy**: These warnings are **ACCEPTABLE** and should be **IGNORED**.

**Rationale**:
- We use PSR-4 autoloading (namespace `FairPlugin\Models\Group` maps to `src/Models/Group.php`)
- WordPress file naming (`class-group.php`) doesn't work with PSR-4
- Modern PHP best practices favor PSR-4 over WordPress conventions
- Linux is case-sensitive, so consistent casing (capital first letter) is important

**Action**: Do not rename files to satisfy these warnings. Keep PSR-4 naming.

## Database Caching Warnings

### Acceptable Warnings

```
WARNING | Use of a direct database call is discouraged.
WARNING | Direct database call without caching detected. Consider using
        | wp_cache_get() / wp_cache_set() or wp_cache_delete().
```

**Policy**: These warnings are **ACCEPTABLE** for now.

**Rationale**:
- Performance optimization concern, not security vulnerability
- Can be addressed in future performance optimization phase
- Adding caching layer requires careful consideration of cache invalidation strategy

**Future Work**: Consider implementing WordPress Object Cache for frequently accessed data:
- Group lists (cache key: `fair_groups_list_{status}_{orderby}_{order}`)
- Individual groups by ID (cache key: `fair_group_{id}`)
- Individual groups by slug (cache key: `fair_group_slug_{slug}`)

## error_log() Warnings

### Warning

```
WARNING | error_log() found. Debug code should not normally be used in production.
```

**Policy**: Acceptable in **installer, migration, and debugging contexts** with phpcs:ignore comment.

**When to use error_log()**:
- Database installation/migration operations (Installer.php)
- Critical debugging points that help diagnose production issues
- Development-only code paths (sample data creation)

**Suppression format**:
```php
error_log( 'Fair Membership: Database tables created/updated' ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Useful for debugging installation issues.
```

**Important**: The error code is `WordPress.PHP.DevelopmentFunctions.error_log_error_log`, not just `error_log`.

**Action**: Add phpcs:ignore comment with justification explaining why the logging is necessary.

## When to Use phpcs:ignore

### Acceptable Use Cases

1. **Table name interpolation** - When table name is properly escaped with `esc_sql()`
   ```php
   // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
   ```

2. **Dynamic SQL variable** - When SQL string contains escaped identifiers and prepared placeholders
   ```php
   // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
   ```

3. **Known safe patterns** - When you've verified the code is secure but linter can't detect it
   ```php
   // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
   ```

4. **error_log() for debugging** - In installer, migration, or critical debugging contexts
   ```php
   // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
   ```

### Required Comment Format

Always add explanation after `--`:

```php
// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table name is escaped with esc_sql()
```

Or use inline comments for specific violations:

```php
$wpdb->prepare( $sql, $id ), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
```

### NEVER Use phpcs:ignore For

1. **Actual SQL injection vulnerabilities** - Fix the code instead
2. **Missing input sanitization** - Add proper sanitization
3. **Escaping output** - Use proper escaping functions
4. **Nonce verification** - Always verify nonces for authenticated operations

## Verification Process

After fixing lint errors, always verify:

1. **Run format command**:
   ```bash
   npm run format
   ```

2. **Check specific file**:
   ```bash
   vendor/bin/phpcs --standard=WordPress --extensions=php path/to/File.php
   ```

3. **Expected output**:
   - "No fixable errors were found" OR
   - Only acceptable warnings (file naming, caching)
   - Zero ERRORS related to SQL injection

4. **Run from root**:
   ```bash
   vendor/bin/phpcs --standard=WordPress --extensions=php plugin-name/src/
   ```

## Code Review Checklist

When reviewing database query code:

- [ ] Table names are escaped with `esc_sql()`
- [ ] User inputs use `$wpdb->prepare()` with placeholders (`%s`, `%d`, `%f`)
- [ ] ORDER BY columns are escaped (if dynamic)
- [ ] phpcs:ignore comments explain why code is safe
- [ ] No direct variable interpolation of user input
- [ ] Conditional queries properly build placeholder arrays
- [ ] Both prepared and unprepared query branches handled (empty vs non-empty values)

## Examples from Codebase

### Example 1: Simple SELECT by ID

```php
public static function get_by_id( $id ) {
    global $wpdb;

    $table_name = esc_sql( $wpdb->prefix . 'fair_groups' );
    $sql        = "SELECT * FROM {$table_name} WHERE id = %d";
    $result     = $wpdb->get_row(
        $wpdb->prepare( $sql, $id ), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        ARRAY_A
    );

    return $result ? new self( $result ) : null;
}
```

**Why this is safe**:
- `$table_name` is escaped with `esc_sql()`
- `$id` uses `%d` placeholder in `prepare()`
- phpcs:ignore only suppresses variable warning, not actual security issues

### Example 2: Dynamic WHERE Clause

```php
public static function count( $args = array() ) {
    global $wpdb;

    $table_name       = esc_sql( $wpdb->prefix . 'fair_groups' );
    $where_conditions = array();
    $where_values     = array();

    if ( isset( $args['status'] ) && ! is_null( $args['status'] ) ) {
        $where_conditions[] = 'status = %s';
        $where_values[]     = $args['status'];
    }

    $where_clause = ! empty( $where_conditions ) ? 'WHERE ' . implode( ' AND ', $where_conditions ) : '';
    $sql          = "SELECT COUNT(*) FROM {$table_name} {$where_clause}";

    if ( ! empty( $where_values ) ) {
        // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        return (int) $wpdb->get_var( $wpdb->prepare( $sql, $where_values ) );
    }

    // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    return (int) $wpdb->get_var( $sql );
}
```

**Why this is safe**:
- Table name escaped with `esc_sql()`
- WHERE conditions use placeholders (`%s`)
- Values array passed to `prepare()`
- Handles both cases: with and without WHERE clause

## Common Mistakes and Fixes

### Mistake 1: Inline String with Variable

```php
// ❌ Before (UNSAFE)
$result = $wpdb->get_row(
    $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}fair_groups WHERE id = %d", $id )
);
```

```php
// ✅ After (SAFE)
$table_name = esc_sql( $wpdb->prefix . 'fair_groups' );
$sql        = "SELECT * FROM {$table_name} WHERE id = %d";
$result     = $wpdb->get_row(
    $wpdb->prepare( $sql, $id ), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    ARRAY_A
);
```

### Mistake 2: Wrong phpcs:ignore Placement

```php
// ❌ Before (Doesn't work)
// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
$sql = "SELECT * FROM {$table_name} WHERE id = %d";
$result = $wpdb->get_row( $wpdb->prepare( $sql, $id ) );
```

```php
// ✅ After (Works)
$sql    = "SELECT * FROM {$table_name} WHERE id = %d";
$result = $wpdb->get_row(
    $wpdb->prepare( $sql, $id ), // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    ARRAY_A
);
```

### Mistake 3: Forgetting to Merge Arrays for LIMIT

```php
// ❌ Before (Incorrect - values don't match placeholders)
$where_values = array( $status );
$limit_clause = 'LIMIT %d OFFSET %d';
$sql = "SELECT * FROM {$table_name} WHERE status = %s {$limit_clause}";
$results = $wpdb->get_results( $wpdb->prepare( $sql, $where_values ) ); // Missing limit values!
```

```php
// ✅ After (Correct - all placeholder values provided)
$where_values = array( $status );
$limit_values = array( $limit, $offset );
$where_values = array_merge( $where_values, $limit_values );
$sql = "SELECT * FROM {$table_name} WHERE status = %s LIMIT %d OFFSET %d";
$results = $wpdb->get_results( $wpdb->prepare( $sql, $where_values ), ARRAY_A );
```

## Summary

- **Security rules**: Fix the code, don't ignore
- **Table names**: Use `esc_sql()` + phpcs:ignore with explanation
- **User input**: Always use `$wpdb->prepare()` with placeholders
- **File naming**: PSR-4 naming is correct, ignore WordPress conventions
- **Caching warnings**: Acceptable for now, address in optimization phase
- **Always verify**: Run format command after changes

## References

- [WordPress Coding Standards](https://developer.wordpress.org/coding-standards/wordpress-coding-standards/php/)
- [wpdb Class Reference](https://developer.wordpress.org/reference/classes/wpdb/)
- [Data Validation](https://developer.wordpress.org/apis/security/data-validation/)
- [Escaping](https://developer.wordpress.org/apis/security/escaping/)
