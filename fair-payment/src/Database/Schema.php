<?php
/**
 * Database schema for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Database;

defined( 'WPINC' ) || die;

/**
 * Schema class for managing database tables
 */
class Schema {
	/**
	 * Get the table name for payment transactions
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_payments_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_transactions';
	}

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	public static function create_tables() {
		global $wpdb;

		$table_name      = self::get_payments_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE $table_name (
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
			PRIMARY KEY  (id),
			KEY mollie_payment_id (mollie_payment_id),
			KEY status (status),
			KEY user_id (user_id),
			KEY post_id (post_id)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Store database version for future migrations.
		update_option( 'fair_payment_db_version', '1.0' );
	}

	/**
	 * Drop database tables (used for uninstall)
	 *
	 * @return void
	 */
	public static function drop_tables() {
		global $wpdb;
		$table_name = self::get_payments_table_name();
		$wpdb->query( "DROP TABLE IF EXISTS $table_name" );
		delete_option( 'fair_payment_db_version' );
	}
}
