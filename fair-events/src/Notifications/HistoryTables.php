<?php
/**
 * Notification history tables.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Creates the execution and delivery history tables
 * ({@see ExecutionHistory}, {@see DeliveryHistory}) and writes their rows.
 *
 * The moment the tables were first created is kept: history recorded
 * elsewhere before it is imported by {@see HistoryMigration}, history from
 * then on is recorded directly.
 */
class HistoryTables {
	public const DB_VERSION        = '1';
	public const DB_VERSION_OPTION = 'fair_events_notification_history_db_version';
	public const SINCE_OPTION      = 'fair_events_notification_history_since';

	/**
	 * Whether the tables are at the current version.
	 *
	 * @return bool
	 */
	public static function is_current() {
		return self::DB_VERSION === (string) get_option( self::DB_VERSION_OPTION, '' );
	}

	/**
	 * Create or upgrade the tables when their version changed.
	 *
	 * Call while holding {@see Lock::MIGRATION}.
	 *
	 * @return bool Whether the tables are at the current version.
	 */
	public static function maybe_install() {
		if ( self::is_current() ) {
			return true;
		}

		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		dbDelta( ExecutionHistory::schema( $charset ) );
		dbDelta( DeliveryHistory::schema( $charset ) );

		foreach ( array( ExecutionHistory::table_name(), DeliveryHistory::table_name() ) as $table ) {
			if ( $table !== $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) ) {
				return false;
			}
		}

		if ( false === get_option( self::SINCE_OPTION, false ) ) {
			update_option( self::SINCE_OPTION, current_time( 'mysql', true ), false );
		}
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
		return true;
	}

	/**
	 * When recording into the tables began, UTC 'Y-m-d H:i:s', or '' before.
	 *
	 * @return string
	 */
	public static function since() {
		return (string) get_option( self::SINCE_OPTION, '' );
	}

	/**
	 * Insert a row unless it repeats a unique key.
	 *
	 * @param string $table   Table name.
	 * @param array  $columns Values keyed by column; null is stored as NULL,
	 *                        integers as numbers, everything else as text.
	 * @return int The new row's ID, 0 when no row was added.
	 */
	public static function insert_ignore( $table, array $columns ) {
		global $wpdb;
		$placeholders = array();
		$values       = array( $table );
		foreach ( $columns as $column => $value ) {
			$values[] = $column;
		}
		foreach ( $columns as $value ) {
			if ( null === $value ) {
				$placeholders[] = 'NULL';
			} elseif ( is_int( $value ) ) {
				$placeholders[] = '%d';
				$values[]       = $value;
			} else {
				$placeholders[] = '%s';
				$values[]       = (string) $value;
			}
		}
		$identifiers  = implode( ',', array_fill( 0, count( $columns ), '%i' ) );
		$placeholders = implode( ',', $placeholders );
		$result       = $wpdb->query(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- placeholders only, built from the column list.
			$wpdb->prepare( "INSERT IGNORE INTO %i ({$identifiers}) VALUES ({$placeholders})", $values )
		);

		return 1 === $result ? (int) $wpdb->insert_id : 0;
	}
}
