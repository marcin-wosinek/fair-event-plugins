<?php
/**
 * Database migration runner for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Migration;

defined( 'WPINC' ) || die;

/**
 * Runs dbDelta-based table creation for the experimental plugin.
 *
 * Kept intentionally minimal: one table, one version option. The experimental
 * plugin has no activation hook and no migration chain in the stable plugin —
 * this self-contained runner fires on plugins_loaded so it works on first load
 * even without a re-activation.
 */
class Migration {

	const DB_VERSION        = 1;
	const DB_VERSION_OPTION = 'fair_payment_experimental_db_version';

	/**
	 * Register the upgrade check.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'plugins_loaded', array( $this, 'maybe_upgrade' ), 5 );
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

		if ( $installed < 1 ) {
			$this->create_notification_queue_table();
		}

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Create the notification queue table.
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
			channel varchar(20) NOT NULL DEFAULT '',
			destination text NOT NULL,
			rendered_text longtext NOT NULL,
			amount varchar(20) NOT NULL DEFAULT '',
			currency varchar(10) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			sent_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY route_id (route_id),
			KEY sent_at (sent_at)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}
}
