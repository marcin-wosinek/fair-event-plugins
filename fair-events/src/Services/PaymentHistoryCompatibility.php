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
 * - shadow_write_coverage(): every live payment writer also writes links.
 *   False until stage 3 implements and turns on that coverage.
 * - migration_verified(): the backfill finished and its verification
 *   report was clean (§8.4). Set by stage 3; false until then.
 * - ownership_cutover(): payment links are authoritative for purchases.
 *   False until stage 4.
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
	 * Whether every live payment writer also records payment links (shadow
	 * writes, §8.1). Stage 2 leaves storage empty, so this is false; stage 3
	 * turns it on once every writer is covered, before taking its cutoff.
	 *
	 * @return bool
	 */
	public static function shadow_write_coverage() {
		return false;
	}

	/**
	 * Whether the backfill completed with a clean verification report.
	 *
	 * @return bool
	 */
	public static function migration_verified() {
		$state = get_option( self::STATE_OPTION, array() );
		return is_array( $state ) && 'verified' === ( $state['status'] ?? '' );
	}

	/**
	 * Whether payment links are the authority for purchase payments. Nothing
	 * switches authority before stage 4.
	 *
	 * @return bool
	 */
	public static function ownership_cutover() {
		return false;
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
	 * purchase provenance in its capacity filter. An older Audience would
	 * count a backfilled relationship a second time (§8.5), so the backfill
	 * must not start with it.
	 *
	 * @return bool
	 */
	public static function audience_compatible() {
		if ( ! class_exists( \FairAudience\Database\EventParticipantRepository::class ) ) {
			return true;
		}
		return method_exists( \FairAudience\Database\EventParticipantRepository::class, 'excludes_purchase_provenance' )
			&& true === \FairAudience\Database\EventParticipantRepository::excludes_purchase_provenance();
	}

	/**
	 * Reasons the stage 3 backfill can't start on this site; empty when it
	 * can. Stage 3 must refuse to start while any is listed.
	 *
	 * @return string[] Codes: storage_unavailable, shadow_writes_incomplete,
	 *                  payment_information_unavailable, audience_incompatible.
	 */
	public static function backfill_blockers() {
		$blockers = array();
		if ( ! self::storage_available() ) {
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
	 * Forget the cached table check, e.g. after the installer ran.
	 *
	 * @return void
	 */
	public static function reset_cache() {
		self::$links_table_exists = null;
	}
}
