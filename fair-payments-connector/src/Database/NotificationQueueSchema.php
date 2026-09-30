<?php
/**
 * Payment notification queue schema for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Database;

use FairPaymentsConnector\Settings\NotificationSettings;

defined( 'WPINC' ) || die;

/**
 * Creates the digest notification queue and adopts rows queued by Fair
 * Payments Connector Experimental.
 *
 * The table name, columns and row states are unchanged from the experimental
 * plugin, so rows it queued stay deliverable. That plugin tracked its own
 * schema in LEGACY_VERSION_OPTION; this class brings a queue from any of its
 * versions up to date and then records the current version there, so an
 * experimental release that is still active never repeats the work.
 */
class NotificationQueueSchema {

	/**
	 * Schema version option written by the experimental plugin.
	 */
	const LEGACY_VERSION_OPTION = 'fair_payment_experimental_db_version';

	/**
	 * Queue schema version the experimental plugin's last release creates.
	 */
	const LEGACY_CURRENT_VERSION = 2;

	/**
	 * Fully prefixed table name.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;

		return $wpdb->prefix . 'fair_payment_notification_queue';
	}

	/**
	 * Create or update the queue table, then adopt any existing rows.
	 *
	 * @return void
	 */
	public static function migrate() {
		self::create_table();
		self::adopt_legacy_queue();
	}

	/**
	 * Create or update the notification queue table.
	 *
	 * @return void
	 */
	public static function create_table() {
		global $wpdb;

		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			route_id varchar(64) NOT NULL DEFAULT '',
			frequency varchar(10) NOT NULL DEFAULT 'daily',
			channel varchar(20) NOT NULL DEFAULT '',
			destination text NOT NULL,
			rendered_text longtext NOT NULL,
			amount varchar(20) NOT NULL DEFAULT '',
			currency varchar(10) NOT NULL DEFAULT '',
			status varchar(10) NOT NULL DEFAULT 'pending',
			claim_token varchar(32) NOT NULL DEFAULT '',
			claimed_at datetime DEFAULT NULL,
			attempts int(10) unsigned NOT NULL DEFAULT 0,
			last_error varchar(255) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			sent_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY route_id (route_id),
			KEY sent_at (sent_at),
			KEY delivery (frequency,status,claimed_at),
			KEY claim_token (claim_token)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Give rows from an older experimental queue a delivery state, once.
	 *
	 * Version 1 of the experimental queue had no delivery columns; its rows need
	 * the backfill. A queue already at the current version, or created fresh,
	 * needs nothing beyond recording that version.
	 *
	 * @return void
	 */
	public static function adopt_legacy_queue() {
		$installed = (int) get_option( self::LEGACY_VERSION_OPTION, 0 );
		if ( $installed >= self::LEGACY_CURRENT_VERSION ) {
			return;
		}

		if ( $installed >= 1 ) {
			self::backfill_delivery_state();
		}

		update_option( self::LEGACY_VERSION_OPTION, self::LEGACY_CURRENT_VERSION );
	}

	/**
	 * Give rows queued before the delivery columns existed a delivery state.
	 *
	 * Rows that were already sent become `sent`; unsent rows take the frequency
	 * of the route they were queued for, falling back to the column default
	 * (`daily`) when that route no longer exists.
	 *
	 * @return void
	 */
	private static function backfill_delivery_state() {
		global $wpdb;

		$table = self::table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare( 'UPDATE %i SET status = %s WHERE sent_at IS NOT NULL', $table, 'sent' )
		);

		$digest_frequencies = array( 'hourly', 'daily', 'weekly' );

		foreach ( (array) get_option( NotificationSettings::ROUTES_OPTION, array() ) as $route ) {
			if ( empty( $route['id'] ) || empty( $route['frequency'] ) || ! in_array( $route['frequency'], $digest_frequencies, true ) ) {
				continue;
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET frequency = %s WHERE route_id = %s AND sent_at IS NULL',
					$table,
					$route['frequency'],
					(string) $route['id']
				)
			);
		}
	}
}
