<?php
/**
 * Payment history migration capabilities
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\Schema;

defined( 'WPINC' ) || die;

/**
 * What this site supports of the payment history migration (#2111), as
 * capability checks rather than version comparisons
 * (PAYMENT_HISTORY_MIGRATION.md §8.6). Each check is separate on purpose:
 *
 * - storage_available(): the payment links table and the purchase
 *   provenance column exist. Both legacy admission filters skip
 *   relationships named by provenance from then on.
 * - shadow_write_coverage(): every live payment writer also writes links
 *   and Audience-only admissions have shadow purchases
 *   (PaymentHistoryShadowWrites). On once the site supports it and the
 *   coverage floors are recorded.
 * - migration_verified(): the backfill finished and its verification
 *   report was clean (§8.4). Set by stage 3; false until then.
 * - ownership_cutover(): payment links are authoritative for purchases.
 *   True once the stage 4 activation is recorded.
 *
 * backfill_blockers() lists what stops the stage 3 backfill from starting.
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
	 * Whether this site can run shadow writes: the links storage and the
	 * shadow work queue exist, and an active Fair Audience skips the
	 * relationships and activities that shadow purchases stand for.
	 *
	 * @return bool
	 */
	public static function shadow_writes_supported() {
		return self::storage_available()
			&& version_compare( Schema::get_db_version(), self::SHADOW_DB_VERSION, '>=' )
			&& self::audience_compatible();
	}

	/**
	 * Whether every live payment writer also records payment links (shadow
	 * writes, §8.1, §8.8): supported, and turned on with its coverage floors
	 * recorded by PaymentHistoryShadowWrites::maybe_enable(), before the
	 * backfill takes its cutoff.
	 *
	 * @return bool
	 */
	public static function shadow_write_coverage() {
		if ( ! self::shadow_writes_supported() ) {
			return false;
		}
		$state = self::get_state();
		return is_array( $state['shadow_writes'] ?? null ) && ! empty( $state['shadow_writes']['enabled_at'] );
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
	 * Whether payment links are the authority for purchase payments (stage
	 * 4, §8.1): the lifecycle writes links first and resolves purchases from
	 * them (PurchaseLifecycle).
	 *
	 * True once an administrator's activation is recorded in the state
	 * option's `cutover` entry and the storage it relies on (links and the
	 * work queue) exists. The activation is kept apart from the backfill's
	 * mutable `status`: a later verification failure never clears it, so
	 * ledger authority is never silently restored and recovery is forward
	 * repair (§8.5). Only the stage 4 activation writes the entry.
	 *
	 * @return bool
	 */
	public static function ownership_cutover() {
		if ( ! self::storage_available() || version_compare( Schema::get_db_version(), self::SHADOW_DB_VERSION, '<' ) ) {
			return false;
		}
		$cutover = self::get_state()['cutover'] ?? null;
		return is_array( $cutover ) && ! empty( $cutover['activated_at'] );
	}

	/**
	 * Whether Connector's transactions can be read: the plugin is active and
	 * its table exists. When false, revenue is unavailable, never zero.
	 *
	 * @return bool
	 */
	public static function payment_information_available() {
		if ( ! class_exists( \FairPaymentsConnector\Models\Transaction::class )
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
	 * instead. An older Audience would count them a second time (§8.5), so
	 * neither shadow writes nor the backfill run with it.
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
	 * Reasons the stage 3 backfill can't start on this site; empty when it
	 * can. Stage 3 must refuse to start while any is listed. Storage counts
	 * as unavailable until the backfill's own tables (DB 3.51.0) exist too.
	 *
	 * @return string[] Codes: storage_unavailable, shadow_writes_incomplete,
	 *                  payment_information_unavailable, audience_incompatible.
	 */
	public static function backfill_blockers() {
		$blockers = array();
		if ( ! self::storage_available() || version_compare( Schema::get_db_version(), self::BACKFILL_DB_VERSION, '<' ) ) {
			$blockers[] = 'storage_unavailable';
		}
		if ( ! self::shadow_write_coverage() ) {
			$blockers[] = 'shadow_writes_incomplete';
		}
		if ( ! self::payment_information_available() ) {
			$blockers[] = 'payment_information_unavailable';
		}
		if ( ! self::audience_compatible() ) {
			$blockers[] = 'audience_incompatible';
		}
		return $blockers;
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
