<?php
/**
 * Database migration runner for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Migration;

use FairPaymentsConnectorExperimental\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Runs dbDelta-based table creation for the experimental plugin.
 *
 * Kept intentionally minimal: one table, one version option. The experimental
 * plugin has no activation hook and no migration chain in the stable plugin —
 * this self-contained runner fires on init so it works on first load even
 * without a re-activation.
 *
 * It must not hook `plugins_loaded`: Plugin::instance() itself runs at
 * `plugins_loaded` priority 10, and WordPress does not run a lower-priority
 * callback added to the hook that is currently firing, so the upgrade would
 * never execute.
 */
class Migration {

	const DB_VERSION        = 2;
	const DB_VERSION_OPTION = 'fair_payment_experimental_db_version';

	/**
	 * Register the upgrade check.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'init', array( $this, 'maybe_upgrade' ), 5 );
	}

	/**
	 * Run pending migrations when the stored version is behind.
	 *
	 * @return void
	 */
	public function maybe_upgrade() {
		$installed = (int) get_option( self::DB_VERSION_OPTION, 0 );
		if ( $installed >= self::DB_VERSION ) {
			return;
		}

		// dbDelta() creates the table on a fresh site and adds the delivery
		// columns and indexes to an existing one.
		$this->create_notification_queue_table();

		if ( $installed >= 1 ) {
			$this->backfill_delivery_state();
		}

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Create or update the notification queue table.
	 *
	 * @return void
	 */
	private function create_notification_queue_table() {
		global $wpdb;

		$table   = $wpdb->prefix . 'fair_payment_notification_queue';
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
	 * Give rows queued before the delivery columns existed a delivery state.
	 *
	 * Rows that were already sent become `sent`; unsent rows take the frequency
	 * of the route they were queued for, falling back to the column default
	 * (`daily`) when that route no longer exists.
	 *
	 * @return void
	 */
	private function backfill_delivery_state() {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_payment_notification_queue';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare( 'UPDATE %i SET status = %s WHERE sent_at IS NOT NULL', $table, 'sent' )
		);

		$digest_frequencies = array( 'hourly', 'daily', 'weekly' );

		foreach ( (array) get_option( Settings::ROUTES_OPTION, array() ) as $route ) {
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
