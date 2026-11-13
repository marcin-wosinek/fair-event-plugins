<?php
/**
 * Payment history migration capabilities
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\Schema;
use FairEvents\Models\PaymentHistoryFinding;

defined( 'WPINC' ) || die;

/**
 * What this site supports of the payment history migration (#2111), as
 * capability checks rather than version comparisons
 * (PAYMENT_HISTORY_MIGRATION.md §8.6). Each check is separate on purpose:
 *
 * - storage_available(): the payment links table and the purchase
 *   provenance column exist. Both legacy admission filters skip
 *   relationships named by provenance from then on.
 * - migration_verified(): the backfill finished and its verification
 *   report was clean (§8.4), as the retired migration recorded it.
 * - ownership_cutover(): whether the retired stage 4 activation was
 *   recorded. Payment links are authoritative for purchases
 *   unconditionally (#2251), so no runtime path reads it.
 *
 * The one-time migration's controls are retired (#2252). These readers of
 * its recorded state stay: on a site without completion evidence the
 * upgrade gate still decides from them (§8.17). The source-history cleanup
 * removes their options on a site with evidence (§8.21), where they then
 * read nothing. The shadow writes and their coverage floors are retired
 * (#2253).
 * Fair Audience calls into this class only after checking it and the method
 * exist, so newer Audience keeps working with older Events.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryCompatibility {

	/**
	 * First database version with payment links and purchase provenance.
	 */
	const STORAGE_DB_VERSION = '3.49.0';

	/**
	 * First database version with the shadow work queue.
	 */
	const SHADOW_DB_VERSION = '3.50.0';

	/**
	 * First database version with the backfill's findings and comparisons.
	 */
	const BACKFILL_DB_VERSION = '3.51.0';

	/**
	 * First database version with the reconciliation audit.
	 */
	const RECONCILIATION_DB_VERSION = '3.52.0';

	/**
	 * Option holding the migration's state; written by later stages.
	 */
	const STATE_OPTION = 'fair_events_payment_history_migration';

	/**
	 * Option holding the retired stage 4 activation. Kept apart from
	 * STATE_OPTION, which the shadow writes rewrite as they go, so no
	 * writer of the migration's state can drop it.
	 */
	const CUTOVER_OPTION = 'fair_events_payment_history_cutover';

	/**
	 * Option holding the retired stage 5 (Statistics readers) activation.
	 */
	const READERS_OPTION = 'fair_events_payment_history_readers';

	/**
	 * Stage 5 activation reason: switched after a clean verification.
	 */
	const READERS_REASON_VERIFIED = 'reader_cutover';

	/**
	 * Stage 5 activation reason: the site had no Fair Audience history.
	 */
	const READERS_REASON_NO_HISTORY = 'no_source_history';

	/**
	 * Whether the links table was found, cached per request.
	 *
	 * @var bool|null
	 */
	private static $links_table_exists = null;

	/**
	 * Whether payment links and purchase provenance can be stored and read.
	 *
	 * @return bool
	 */
	public static function storage_available() {
		if ( version_compare( Schema::get_db_version(), self::STORAGE_DB_VERSION, '<' ) ) {
			return false;
		}

		if ( null === self::$links_table_exists ) {
			global $wpdb;
			$table                    = $wpdb->prefix . 'fair_events_signup_payment_links';
			self::$links_table_exists = $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		}

		return self::$links_table_exists;
	}

	/**
	 * Whether the legacy admission filters must skip relationships that a
	 * purchase names as its provenance. Checked by Fair Audience before it
	 * adds the provenance condition to its capacity filter.
	 *
	 * @return bool
	 */
	public static function purchase_provenance_available() {
		return self::storage_available();
	}

	/**
	 * The migration's state option as an array.
	 *
	 * @return array
	 */
	public static function get_state() {
		$state = get_option( self::STATE_OPTION, array() );
		return is_array( $state ) ? $state : array();
	}

	/**
	 * Whether the backfill completed with a clean verification report.
	 *
	 * @return bool
	 */
	public static function migration_verified() {
		return 'verified' === ( self::get_state()['status'] ?? '' );
	}

	/**
	 * Whether the retired stage 4 activation (§8.1) was recorded. The
	 * purchase lifecycle doesn't read it: it is authoritative
	 * unconditionally (PurchaseLifecycle, #2251).
	 *
	 * True when an administrator's activation is recorded in
	 * CUTOVER_OPTION and the storage it relies on (links and the work
	 * queue) exists. Nothing writes it since #2252.
	 *
	 * @return bool
	 */
	public static function ownership_cutover() {
		if ( ! self::storage_available() || version_compare( Schema::get_db_version(), self::SHADOW_DB_VERSION, '<' ) ) {
			return false;
		}
		return null !== self::get_cutover();
	}

	/**
	 * The recorded stage 4 activation, or null when there is none.
	 *
	 * @return array|null activated_at, user_id, reference, backup_confirmed_at, verification, audit_id.
	 */
	public static function get_cutover() {
		$cutover = get_option( self::CUTOVER_OPTION, null );
		return is_array( $cutover ) && ! empty( $cutover['activated_at'] ) ? $cutover : null;
	}

	/**
	 * The recorded stage 5 (Statistics readers) activation, or null when
	 * there is none. Nothing writes it since #2252; the upgrade gate reads
	 * it as completion evidence.
	 *
	 * @return array|null activated_at, reason, and the activation details.
	 */
	public static function get_readers_activation() {
		$activation = get_option( self::READERS_OPTION, null );
		return is_array( $activation ) && ! empty( $activation['activated_at'] ) ? $activation : null;
	}

	/**
	 * The backfill run recorded in the migration's state, or null.
	 *
	 * @return array|null
	 */
	public static function get_backfill_run() {
		$state = self::get_state();
		$mode  = PaymentHistoryFinding::MODE_BACKFILL;
		return is_array( $state[ $mode ] ?? null ) ? $state[ $mode ] : null;
	}

	/**
	 * Whether Connector's transactions can be read: the plugin is active and
	 * its table exists. When false, revenue is unavailable, never zero.
	 * Active means its main file ran (FAIR_PAYMENTS_CONNECTOR_VERSION), not
	 * only that its classes autoload: another plugin's Composer autoloader
	 * can still find them while Connector is deactivated.
	 *
	 * @return bool
	 */
	public static function payment_information_available() {
		if ( ! defined( 'FAIR_PAYMENTS_CONNECTOR_VERSION' )
			|| ! class_exists( \FairPaymentsConnector\Models\Transaction::class )
			|| ! method_exists( \FairPaymentsConnector\Models\Transaction::class, 'get_by_id' )
			|| ! class_exists( \FairPaymentsConnector\Database\Schema::class )
			|| ! method_exists( \FairPaymentsConnector\Database\Schema::class, 'get_payments_table_name' )
		) {
			return false;
		}

		global $wpdb;
		$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
		return $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
	}

	/**
	 * Whether the active Fair Audience, if any, skips relationships named by
	 * purchase provenance in its capacity filters: both their admissions and
	 * their participant-scope activities, which the purchase's unit carries
	 * instead. An older Audience would count them a second time (§8.5); the
	 * retired migration refused to run with it.
	 *
	 * @return bool
	 */
	public static function audience_compatible() {
		$repository = \FairAudience\Database\EventParticipantRepository::class;
		if ( ! class_exists( $repository ) ) {
			return true;
		}
		return method_exists( $repository, 'excludes_purchase_provenance' )
			&& true === $repository::excludes_purchase_provenance()
			&& method_exists( $repository, 'excludes_provenance_activity_selections' )
			&& true === $repository::excludes_provenance_activity_selections();
	}

	/**
	 * Whether the active Fair Audience, if any, runs its purchase route,
	 * add-ons and series upgrades through the Events purchase lifecycle
	 * once the cutover is active (§8.12): it records each attempt with
	 * PurchaseLifecycle before the buyer pays, leaves paid notifications of
	 * those routes to Events and projects what Events committed. An older
	 * Audience keeps confirming its own relationships, which Events would
	 * no longer follow, so the stage 4 activation refuses to run with it.
	 *
	 * @return bool
	 */
	public static function audience_lifecycle_available() {
		if ( ! class_exists( \FairAudience\Database\EventParticipantRepository::class ) ) {
			return true;
		}
		$lifecycle = 'FairAudience\\Services\\EventsLifecycle';
		return class_exists( $lifecycle )
			&& method_exists( $lifecycle, 'supports_purchase_lifecycle' )
			&& true === $lifecycle::supports_purchase_lifecycle();
	}

	/**
	 * Whether administrators can reconcile findings: the backfill's tables
	 * and the reconciliation audit (DB 3.52.0) exist. Reconciliation also
	 * needs Connector, checked per action.
	 *
	 * @return bool
	 */
	public static function reconciliation_available() {
		return self::storage_available()
			&& version_compare( Schema::get_db_version(), self::RECONCILIATION_DB_VERSION, '>=' );
	}

	/**
	 * Forget the cached table check, e.g. after the installer ran.
	 *
	 * @return void
	 */
	public static function reset_cache() {
		self::$links_table_exists = null;
	}
}
