<?php
/**
 * Supported upgrade path after the payment history migration
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\Installer;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;

defined( 'WPINC' ) || die;

/**
 * Whether this site may run a Fair Events release whose purchases and
 * accounting no longer go through the payment history migration (#2251
 * onward), and the evidence that says so (PAYMENT_HISTORY_MIGRATION.md
 * §8.17).
 *
 * - Completion evidence lives in EVIDENCE_OPTION, written once and never
 *   removed: a fresh installation records it before its first tables, a
 *   site that finished the migration on the intermediate release records
 *   it the first time this release sees the finished state. The cleanup
 *   that removes the migration's own records (§8.21) keeps it,
 *   because afterwards nothing else can tell a migrated site from an
 *   unmigrated one.
 * - An existing site whose stored data proves there is nothing to migrate
 *   (source_history(): no payment reference, Audience ledger row, legacy
 *   admission or participant-scope activity, migration work or finding,
 *   whether Fair Payments Connector is installed or not) records it as
 *   evidence too, and initializes without the intermediate release.
 * - Any other existing site without that evidence, including one whose
 *   data can't be read with certainty, is an unsupported upgrade:
 *   allows_initialization() is false, Fair Events (and Fair Audience,
 *   which asks the same) start nothing but an administrator notice, and
 *   neither runs its installer, so nothing is written until the
 *   intermediate release finishes the migration.
 * - Versions never decide: only recorded state does.
 *
 * The operator's staging verification (STAGING_OPTION, the §8.15 checks)
 * is separate evidence. It doesn't make a site safe to upgrade; it is one
 * of the conditions for the source-history cleanup (PaymentHistoryCleanup,
 * §8.21), which removes the intermediate release's records this class
 * reads in facts(). After it, the evidence alone allows a migrated site,
 * and a site without it is still refused.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryUpgrade {

	/**
	 * Option holding the completion evidence. Durable: never deleted.
	 */
	const EVIDENCE_OPTION = 'fair_events_payment_history_completion';

	/**
	 * Option holding the operator's staging verification.
	 */
	const STAGING_OPTION = 'fair_events_payment_history_staging_verification';

	/**
	 * Evidence basis: Fair Events was first installed by a release with this check.
	 */
	const BASIS_FRESH_INSTALL = 'fresh_install';

	/**
	 * Evidence basis: the migration finished with both switches recorded.
	 */
	const BASIS_MIGRATED = 'migrated';

	/**
	 * Evidence basis: the intermediate release recorded that there was nothing to migrate.
	 */
	const BASIS_NO_SOURCE_HISTORY = 'no_source_history';

	/**
	 * Evidence basis: this release read the stored data and found nothing
	 * the migration would have to move (source_history()).
	 */
	const BASIS_VERIFIED_NO_HISTORY = 'verified_no_history';

	/**
	 * State of source_history(): every source was read and is empty.
	 */
	const HISTORY_ABSENT = 'absent';

	/**
	 * State of source_history(): at least one source holds records.
	 */
	const HISTORY_PRESENT = 'present';

	/**
	 * State of source_history(): a source couldn't be read.
	 */
	const HISTORY_UNVERIFIABLE = 'unverifiable';

	/**
	 * The sources source_history() reads, in order.
	 */
	const HISTORY_SOURCES = array(
		'payment_transactions',
		'signup_payment_references',
		'payment_links',
		'backfilled_purchases',
		'audience_ledger',
		'legacy_admissions',
		'participant_activities',
		'migration_work',
		'migration_findings',
	);

	/**
	 * The last release with the complete migration workflow (stage 5),
	 * before the runtime stopped depending on it.
	 */
	const INTERMEDIATE_RELEASE = 'build-2.2.0';

	/**
	 * Where the intermediate release's plugin archives are downloaded.
	 */
	const INTERMEDIATE_RELEASE_URL = 'https://github.com/marcin-wosinek/fair-event-plugins/releases/tag/build-2.2.0';

	/**
	 * Operator guidance for this upgrade.
	 */
	const GUIDE_URL = 'https://github.com/marcin-wosinek/fair-event-plugins/blob/main/DEPLOYMENT.md#upgrade-notes-supported-upgrade-path-after-the-payment-history-migration-2255';

	/**
	 * Plugin versions of the intermediate release, in update order.
	 */
	const INTERMEDIATE_VERSIONS = array(
		'fair-payments-connector' => '2.8.0',
		'fair-events'             => '2.2.0',
		'fair-audience'           => '2.0.0',
	);

	/**
	 * The §8.15 final verification checks an operator records from staging.
	 */
	const STAGING_CHECKS = array(
		'representative_purchases',
		'statistics_revenue',
		'shared_allocations',
		'finance_participant_attempts',
		'audience_reactivation',
	);

	/**
	 * Longest note stored with the staging verification.
	 */
	const NOTE_MAX_LENGTH = 1000;

	/**
	 * Shadow write kinds: work the migration owes, not current purchases.
	 */
	const MIGRATION_WORK_KINDS = array( PaymentShadowWork::KIND_TRANSACTION, PaymentShadowWork::KIND_RELATIONSHIP );

	/**
	 * The decision for this request, once made.
	 *
	 * @var bool|null
	 */
	private static $allowed = null;

	/**
	 * Blockers found by the last refused decision.
	 *
	 * @var string[]
	 */
	private static $blockers = array();

	/**
	 * What the last refused decision read from source_history(), if it did.
	 *
	 * @var array|null
	 */
	private static $history = null;

	/**
	 * Whether Fair Events (and Fair Audience) may initialize: completion
	 * evidence is recorded, the site is a fresh installation, the
	 * intermediate release's records show a finished migration, or the
	 * stored data proves there is nothing to migrate. The last two are
	 * then recorded as evidence. Made once per request.
	 *
	 * @return bool
	 */
	public static function allows_initialization() {
		if ( null !== self::$allowed ) {
			return self::$allowed;
		}

		if ( self::get_evidence() || Installer::is_fresh_install() ) {
			self::$allowed = true;
			return true;
		}

		$facts    = self::facts();
		$decision = self::decide( $facts );
		if ( ! $decision['blockers'] ) {
			self::record_evidence( self::evidence_record( $decision['basis'], $facts ) );
			self::$allowed = true;
			return true;
		}

		// No finished migration: allowed only when nothing needs one.
		$history = self::source_history();
		if ( self::HISTORY_ABSENT === $history['state'] ) {
			self::record_evidence( self::evidence_record( self::BASIS_VERIFIED_NO_HISTORY, $history ) );
			self::$allowed = true;
			return true;
		}

		self::$history  = $history;
		self::$blockers = self::with_history_blocker( $decision['blockers'], $history );
		self::$allowed  = false;
		return false;
	}

	/**
	 * The decision's blockers, plus why the stored data didn't qualify.
	 *
	 * @param string[] $blockers From decide().
	 * @param array    $history  From source_history().
	 * @return string[]
	 */
	private static function with_history_blocker( array $blockers, array $history ) {
		if ( self::HISTORY_PRESENT === $history['state'] ) {
			$blockers[] = 'source_history_found';
		} elseif ( self::HISTORY_UNVERIFIABLE === $history['state'] ) {
			$blockers[] = 'source_history_unverifiable';
		}
		return $blockers;
	}

	/**
	 * Whether the stored data holds anything the payment history migration
	 * would have to move. Read-only, and read whether or not Fair Payments
	 * Connector or Fair Audience is installed or active: their tables stay
	 * after either is deactivated or deleted.
	 *
	 * Ordinary events, occurrences, ticket types, free Fair Events signups
	 * and participant profiles are never source history. A source whose
	 * table is absent is empty; a failed read, or a table without the
	 * columns the read needs, makes the whole answer unverifiable, so
	 * uncertainty never allows initialization.
	 *
	 * @return array state (HISTORY_*), sources (code => count, or null when
	 *               unreadable), connector_active.
	 */
	public static function source_history() {
		$sources = array();
		foreach ( self::HISTORY_SOURCES as $code ) {
			$sources[ $code ] = self::count_source( $code );
		}

		return array(
			'state'            => self::history_state( $sources ),
			'sources'          => $sources,
			'connector_active' => defined( 'FAIR_PAYMENTS_CONNECTOR_VERSION' ),
		);
	}

	/**
	 * The state the source counts amount to.
	 *
	 * @param array<string, int|null> $sources From source_history().
	 * @return string HISTORY_*.
	 */
	public static function history_state( array $sources ) {
		$state = self::HISTORY_ABSENT;
		foreach ( self::HISTORY_SOURCES as $code ) {
			if ( ! array_key_exists( $code, $sources ) || null === $sources[ $code ] ) {
				return self::HISTORY_UNVERIFIABLE;
			}
			if ( (int) $sources[ $code ] > 0 ) {
				$state = self::HISTORY_PRESENT;
			}
		}
		return $state;
	}

	/**
	 * Records of one source of history.
	 *
	 * @param string $code One of HISTORY_SOURCES.
	 * @return int|null Count, 0 when its table is absent, null when unreadable.
	 */
	private static function count_source( $code ) {
		global $wpdb;

		$signups = $wpdb->prefix . 'fair_events_signups';
		switch ( $code ) {
			case 'payment_transactions':
				// Every Connector transaction except participant fees,
				// which the migration never covered (§3.2).
				$table = $wpdb->prefix . 'fair_payment_transactions';
				return self::count_in(
					$table,
					static function () use ( $wpdb, $table ) {
						return $wpdb->prepare(
							'SELECT COUNT(*) FROM %i WHERE metadata IS NULL OR metadata NOT LIKE %s',
							$table,
							'%' . $wpdb->esc_like( '"fee_payment_id"' ) . '%'
						);
					}
				);

			case 'signup_payment_references':
				// Paid or payable signups, including those naming a deleted transaction.
				return self::count_in(
					$signups,
					static function () use ( $wpdb, $signups ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE transaction_id IS NOT NULL OR amount > 0', $signups );
					}
				);

			case 'payment_links':
				$table = $wpdb->prefix . 'fair_events_signup_payment_links';
				return self::count_in(
					$table,
					static function () use ( $wpdb, $table ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table );
					}
				);

			case 'backfilled_purchases':
				// Purchases a started migration created from relationships.
				$column = self::column_exists( $signups, 'legacy_event_participant_id' );
				if ( null === $column ) {
					return null;
				}
				if ( ! $column ) {
					return 0;
				}
				return self::count_in(
					$signups,
					static function () use ( $wpdb, $signups ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE legacy_event_participant_id IS NOT NULL', $signups );
					}
				);

			case 'audience_ledger':
				$table = $wpdb->prefix . 'fair_audience_event_participant_transactions';
				return self::count_in(
					$table,
					static function () use ( $wpdb, $table ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table );
					}
				);

			case 'legacy_admissions':
				return self::count_legacy_admissions();

			case 'participant_activities':
				return self::count_participant_activities();

			case 'migration_work':
				$table = PaymentShadowWork::table();
				return self::count_in(
					$table,
					static function () use ( $wpdb, $table ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table );
					}
				);

			case 'migration_findings':
				// Any finding, decided or not: each names a historical record.
				$table = PaymentHistoryFinding::table();
				return self::count_in(
					$table,
					static function () use ( $wpdb, $table ) {
						return $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table );
					}
				);
		}
		return null;
	}

	/**
	 * Fair Audience relationships the migration would turn into purchases
	 * (§4.1), counted conservatively: every `pending_payment` relationship
	 * (a payment in flight), and every `signed_up` one without a confirmed
	 * Fair Events signup of that participant on that date (of its ticket
	 * type, when it has one) or a confirmed ticket they hold there.
	 *
	 * @return int|null
	 */
	private static function count_legacy_admissions() {
		global $wpdb;

		$relationships = $wpdb->prefix . 'fair_audience_event_participants';
		$signups       = $wpdb->prefix . 'fair_events_signups';
		$tickets       = $wpdb->prefix . 'fair_events_tickets';

		$relationships_exist = self::table_exists( $relationships );
		if ( null === $relationships_exist ) {
			return null;
		}
		if ( ! $relationships_exist ) {
			return 0;
		}

		$sql    = 'SELECT COUNT(*) FROM %i AS ep WHERE ep.label = %s';
		$args   = array( $relationships, 'pending_payment' );
		$sql   .= ' OR ( ep.label = %s';
		$args[] = 'signed_up';

		$signup_coverage = self::table_exists( $signups ) ? self::column_exists( $signups, 'participant_id' ) : false;
		if ( null === $signup_coverage ) {
			return null;
		}
		if ( $signup_coverage ) {
			$sql   .= ' AND NOT EXISTS ( SELECT 1 FROM %i AS s WHERE s.participant_id = ep.participant_id AND s.event_date_id = ep.event_date_id AND s.status = %s AND ( ep.ticket_type_id IS NULL OR s.ticket_type_id = ep.ticket_type_id ) )';
			$args[] = $signups;
			$args[] = 'confirmed';
		}

		$ticket_coverage = self::table_exists( $tickets );
		if ( null === $ticket_coverage ) {
			return null;
		}
		if ( $ticket_coverage ) {
			$sql   .= ' AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.holder_participant_id = ep.participant_id AND t.event_date_id = ep.event_date_id AND t.status = %s AND t.deleted_at IS NULL )';
			$args[] = $tickets;
			$args[] = 'confirmed';
		}
		$sql .= ' )';

		return self::read_count( $wpdb->prepare( $sql, ...$args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- placeholders only; built above.
	}

	/**
	 * Participant-scope activity selections the migration would still have
	 * to place on a ticket: any not carried over to one, and any held for a
	 * payment in flight.
	 *
	 * @return int|null
	 */
	private static function count_participant_activities() {
		global $wpdb;

		$table  = $wpdb->prefix . 'fair_audience_event_participant_options';
		$exists = self::table_exists( $table );
		if ( null === $exists ) {
			return null;
		}
		if ( ! $exists ) {
			return 0;
		}

		$carried = self::column_exists( $table, 'ticket_id' );
		if ( null === $carried ) {
			return null;
		}
		if ( ! $carried ) {
			return self::read_count( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table ) );
		}
		return self::read_count( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE ticket_id IS NULL OR status = %s', $table, 'pending_payment' ) );
	}

	/**
	 * Count with a query built only once its table is known to exist.
	 *
	 * @param string   $table Table name.
	 * @param callable $query Returns the prepared COUNT query.
	 * @return int|null 0 when the table is absent, null when unreadable.
	 */
	private static function count_in( $table, callable $query ) {
		$exists = self::table_exists( $table );
		if ( null === $exists ) {
			return null;
		}
		return $exists ? self::read_count( $query() ) : 0;
	}

	/**
	 * Run a prepared COUNT query.
	 *
	 * @param string $sql Prepared query.
	 * @return int|null Null when the query failed.
	 */
	private static function read_count( $sql ) {
		global $wpdb;

		$count = $wpdb->get_var( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- prepared by the caller.
		if ( '' !== (string) $wpdb->last_error || null === $count || ! is_numeric( $count ) ) {
			return null;
		}
		return (int) $count;
	}

	/**
	 * Whether a table exists.
	 *
	 * @param string $table Table name.
	 * @return bool|null Null when the check itself failed.
	 */
	private static function table_exists( $table ) {
		global $wpdb;

		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		if ( '' !== (string) $wpdb->last_error ) {
			return null;
		}
		return $table === $found;
	}

	/**
	 * Whether a table has a column; false when the table is absent.
	 *
	 * @param string $table  Table name.
	 * @param string $column Column name.
	 * @return bool|null Null when the check failed.
	 */
	private static function column_exists( $table, $column ) {
		global $wpdb;

		$exists = self::table_exists( $table );
		if ( ! $exists ) {
			return $exists;
		}
		$found = $wpdb->get_results( $wpdb->prepare( 'SHOW COLUMNS FROM %i LIKE %s', $table, $wpdb->esc_like( $column ) ) );
		if ( '' !== (string) $wpdb->last_error ) {
			return null;
		}
		return ! empty( $found );
	}

	/**
	 * Why the last decision refused initialization.
	 *
	 * @return string[] Codes from decide().
	 */
	public static function refusal_blockers() {
		return self::$blockers;
	}

	/**
	 * What the last refused decision read from the stored data, or null.
	 *
	 * @return array|null From source_history().
	 */
	public static function refusal_history() {
		return self::$history;
	}

	/**
	 * Start nothing but the administrator notice explaining the refusal.
	 *
	 * @return void
	 */
	public static function refuse_initialization() {
		add_action( 'admin_notices', array( static::class, 'render_refusal_notice' ) );
	}

	/**
	 * The recorded completion evidence, or null.
	 *
	 * @return array|null basis, recorded_at, plugin_versions, and for a
	 *                    migrated site the activations it relied on.
	 */
	public static function get_evidence() {
		$evidence = get_option( self::EVIDENCE_OPTION, null );
		return is_array( $evidence ) && ! empty( $evidence['basis'] ) ? $evidence : null;
	}

	/**
	 * Record that Fair Events was installed fresh, before its first table
	 * exists: there is no history, so nothing will ever need migrating.
	 * Called by Installer::install() for a fresh site only.
	 *
	 * @return void
	 */
	public static function record_fresh_install() {
		self::record_evidence( self::evidence_record( self::BASIS_FRESH_INSTALL, array() ) );
		self::$allowed = true;
	}

	/**
	 * The intermediate release's records, read from the site now.
	 *
	 * @return array storage, cutover, readers, verified,
	 *               verification_checked_at, audience_tables, migration_work,
	 *               open_findings.
	 */
	public static function facts() {
		$storage  = PaymentHistoryCompatibility::reconciliation_available();
		$backfill = $storage ? PaymentHistoryCompatibility::get_backfill_run() : null;

		return array(
			'storage'                 => $storage,
			'cutover'                 => PaymentHistoryCompatibility::get_cutover(),
			'readers'                 => PaymentHistoryCompatibility::get_readers_activation(),
			'verified'                => PaymentHistoryCompatibility::migration_verified(),
			'verification_checked_at' => $backfill ? (string) ( $backfill['verification']['checked_at'] ?? '' ) : null,
			'audience_tables'         => ShadowPurchases::audience_tables_exist(),
			'migration_work'          => $storage ? self::count_migration_work() : 0,
			'open_findings'           => $storage ? self::count_blocking_findings() : 0,
		);
	}

	/**
	 * Whether the facts show a finished migration.
	 *
	 * @param array $facts From facts().
	 * @return array basis (null when blocked) and blockers: storage_unavailable,
	 *               ownership_cutover_missing, readers_missing,
	 *               migration_unverified, migration_work_outstanding,
	 *               findings_open.
	 */
	public static function decide( array $facts ) {
		if ( empty( $facts['storage'] ) ) {
			// The intermediate release never ran here: nothing else can be read.
			return array(
				'basis'    => null,
				'blockers' => array( 'storage_unavailable' ),
			);
		}

		$readers_reason = (string) ( $facts['readers']['reason'] ?? '' );
		$work           = (int) ( $facts['migration_work'] ?? 0 );

		// The intermediate release recorded that this site had no Fair
		// Audience history; still true only while Audience has no tables.
		if ( PaymentHistoryCompatibility::READERS_REASON_NO_HISTORY === $readers_reason && empty( $facts['audience_tables'] ) && 0 === $work ) {
			return array(
				'basis'    => self::BASIS_NO_SOURCE_HISTORY,
				'blockers' => array(),
			);
		}

		$blockers = array();
		if ( empty( $facts['cutover'] ) ) {
			$blockers[] = 'ownership_cutover_missing';
		}
		if ( PaymentHistoryCompatibility::READERS_REASON_VERIFIED !== $readers_reason ) {
			$blockers[] = 'readers_missing';
		}
		if ( empty( $facts['verified'] ) ) {
			$blockers[] = 'migration_unverified';
		}
		if ( $work > 0 ) {
			$blockers[] = 'migration_work_outstanding';
		}
		if ( (int) ( $facts['open_findings'] ?? 0 ) > 0 ) {
			$blockers[] = 'findings_open';
		}

		return array(
			'basis'    => $blockers ? null : self::BASIS_MIGRATED,
			'blockers' => $blockers,
		);
	}

	/**
	 * The evidence stored for a basis.
	 *
	 * @param string $basis One of the BASIS_* constants.
	 * @param array  $facts From facts(); from source_history() for
	 *                      BASIS_VERIFIED_NO_HISTORY; empty for a fresh
	 *                      installation.
	 * @return array
	 */
	public static function evidence_record( $basis, array $facts ) {
		$record = array(
			'basis'           => (string) $basis,
			'recorded_at'     => gmdate( 'Y-m-d H:i:s' ),
			'plugin_versions' => self::plugin_versions(),
		);
		if ( self::BASIS_FRESH_INSTALL === $basis ) {
			return $record;
		}
		if ( self::BASIS_VERIFIED_NO_HISTORY === $basis ) {
			// What was read, not a migration: no activation is implied.
			$record['sources_checked']  = array_keys( (array) ( $facts['sources'] ?? array() ) );
			$record['connector_active'] = ! empty( $facts['connector_active'] );
			return $record;
		}

		$record['readers'] = self::activation_summary( $facts['readers'] ?? null, array( 'activated_at', 'reason', 'audit_id' ) );
		if ( self::BASIS_MIGRATED === $basis ) {
			$record['ownership_cutover']       = self::activation_summary( $facts['cutover'] ?? null, array( 'activated_at', 'reference', 'audit_id' ) );
			$record['verification_checked_at'] = (string) ( $facts['verification_checked_at'] ?? '' );
		}
		return $record;
	}

	/**
	 * Store the evidence once. A concurrent request that stored it first wins.
	 *
	 * @param array $record From evidence_record().
	 * @return void
	 */
	private static function record_evidence( array $record ) {
		add_option( self::EVIDENCE_OPTION, $record, '', true );
	}

	/**
	 * The listed fields of a recorded activation.
	 *
	 * @param array|null $activation Activation option value.
	 * @param string[]   $fields     Fields kept.
	 * @return array|null
	 */
	private static function activation_summary( $activation, array $fields ) {
		if ( ! is_array( $activation ) ) {
			return null;
		}
		return array_intersect_key( $activation, array_flip( $fields ) );
	}

	/**
	 * Versions of the payment plugins running in this request.
	 *
	 * @return array<string, string|null>
	 */
	public static function plugin_versions() {
		return array(
			'fair-payments-connector' => defined( 'FAIR_PAYMENTS_CONNECTOR_VERSION' ) ? (string) FAIR_PAYMENTS_CONNECTOR_VERSION : null,
			'fair-events'             => defined( 'FAIR_EVENTS_VERSION' ) ? (string) FAIR_EVENTS_VERSION : null,
			'fair-audience'           => defined( 'FAIR_AUDIENCE_VERSION' ) ? (string) FAIR_AUDIENCE_VERSION : null,
		);
	}

	/**
	 * Shadow writes that failed or found no purchase, still queued. Pending
	 * rows run in the request that queued them and don't count.
	 *
	 * @return int
	 */
	private static function count_migration_work() {
		global $wpdb;
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE kind IN (%s, %s) AND status IN (%s, %s)',
				PaymentShadowWork::table(),
				self::MIGRATION_WORK_KINDS[0],
				self::MIGRATION_WORK_KINDS[1],
				PaymentShadowWork::STATUS_FAILED,
				PaymentShadowWork::STATUS_UNRESOLVED
			)
		);
	}

	/**
	 * Open backfill findings other than informational ones.
	 *
	 * @return int
	 */
	private static function count_blocking_findings() {
		$total = 0;
		foreach ( PaymentHistoryFinding::count_open( PaymentHistoryFinding::MODE_BACKFILL ) as $reason => $count ) {
			if ( ! in_array( $reason, PaymentHistoryFinding::INFORMATIONAL, true ) ) {
				$total += (int) $count;
			}
		}
		return $total;
	}

	/**
	 * The upgrade checklist for administrators.
	 *
	 * @return array evidence, safe_to_upgrade, checks (code => met),
	 *               counts, ready_for_cleanup, staging_verification,
	 *               intermediate_release, plugin_versions.
	 */
	public static function status() {
		$evidence = self::get_evidence();
		$facts    = self::facts();
		$decision = self::decide( $facts );
		$basis    = $evidence ? (string) $evidence['basis'] : null;
		$staging  = self::get_staging_verification();

		$checks = array( 'completion_recorded' => null !== $evidence );
		if ( ! self::without_source_history( $basis ) ) {
			// Recorded evidence answers the historical steps: the cleanup
			// (#2252–#2254) removes the records they were read from.
			$recorded                      = null !== $evidence;
			$checks['migration_verified']  = $recorded || ! empty( $facts['verified'] );
			$checks['ownership_cutover']   = $recorded || ! empty( $facts['cutover'] );
			$checks['readers_switched']    = $recorded || ! empty( $facts['readers'] );
			$checks['no_migration_work']   = 0 === (int) $facts['migration_work'];
			$checks['no_blocking_finding'] = 0 === (int) $facts['open_findings'];
		}

		return array(
			'evidence'             => $evidence,
			'safe_to_upgrade'      => null !== $evidence,
			'checks'               => $checks,
			'blockers'             => $evidence ? array() : self::with_history_blocker( $decision['blockers'], self::source_history() ),
			'counts'               => array(
				'migration_work' => (int) $facts['migration_work'],
				'open_findings'  => (int) $facts['open_findings'],
			),
			'ready_for_cleanup'    => self::cleanup_readiness( $evidence, $facts, $staging, PaymentHistoryCleanup::get_record() ),
			'staging_verification' => $staging,
			'intermediate_release' => array(
				'tag'      => self::INTERMEDIATE_RELEASE,
				'url'      => self::INTERMEDIATE_RELEASE_URL,
				'versions' => self::INTERMEDIATE_VERSIONS,
			),
			'plugin_versions'      => self::plugin_versions(),
		);
	}

	/**
	 * Whether the source-history cleanup (PaymentHistoryCleanup, §8.21)
	 * can run, read from the site now.
	 *
	 * @return array See cleanup_readiness().
	 */
	public static function readiness_now() {
		return self::cleanup_readiness( self::get_evidence(), self::facts(), self::get_staging_verification(), PaymentHistoryCleanup::get_record() );
	}

	/**
	 * Whether the source-history cleanup (§8.21) can run. Never inferred
	 * from versions: it needs the completion evidence, a clean state now
	 * and every staging check recorded as passed. Once it ran, it reports
	 * what it did instead.
	 *
	 * @param array|null $evidence From get_evidence().
	 * @param array      $facts    From facts().
	 * @param array|null $staging  From get_staging_verification().
	 * @param array|null $cleanup  From PaymentHistoryCleanup::get_record().
	 * @return array applicable, ready, completed (the cleanup record, or
	 *               null), blockers: upgrade_unsafe,
	 *               migration_work_outstanding, findings_open,
	 *               staging_verification_incomplete.
	 */
	public static function cleanup_readiness( $evidence, array $facts, $staging, $cleanup = null ) {
		if ( $evidence && self::without_source_history( (string) $evidence['basis'] ) ) {
			// Never had source history: there is nothing to clean up.
			return array(
				'applicable' => false,
				'ready'      => false,
				'completed'  => null,
				'blockers'   => array(),
			);
		}

		if ( $evidence && is_array( $cleanup ) ) {
			// Done: a repeat changes nothing.
			return array(
				'applicable' => true,
				'ready'      => false,
				'completed'  => $cleanup,
				'blockers'   => array(),
			);
		}

		$blockers = array();
		if ( ! $evidence ) {
			$blockers[] = 'upgrade_unsafe';
		}
		if ( (int) ( $facts['migration_work'] ?? 0 ) > 0 ) {
			$blockers[] = 'migration_work_outstanding';
		}
		if ( (int) ( $facts['open_findings'] ?? 0 ) > 0 ) {
			$blockers[] = 'findings_open';
		}
		if ( ! self::staging_complete( $staging ) ) {
			$blockers[] = 'staging_verification_incomplete';
		}

		return array(
			'applicable' => true,
			'ready'      => ! $blockers,
			'completed'  => null,
			'blockers'   => $blockers,
		);
	}

	/**
	 * Whether an evidence basis means the site never had source history.
	 *
	 * @param string|null $basis Evidence basis.
	 * @return bool
	 */
	private static function without_source_history( $basis ) {
		return in_array( $basis, array( self::BASIS_FRESH_INSTALL, self::BASIS_VERIFIED_NO_HISTORY ), true );
	}

	/**
	 * Whether every staging check is recorded as passed.
	 *
	 * @param array|null $staging From get_staging_verification().
	 * @return bool
	 */
	public static function staging_complete( $staging ) {
		if ( ! is_array( $staging ) || empty( $staging['verified_on'] ) ) {
			return false;
		}
		foreach ( self::STAGING_CHECKS as $check ) {
			if ( empty( $staging['checks'][ $check ] ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * The recorded staging verification, or null.
	 *
	 * @return array|null verified_on, versions, checks, note, user_id,
	 *                    user_name, recorded_at.
	 */
	public static function get_staging_verification() {
		$staging = get_option( self::STAGING_OPTION, null );
		if ( ! is_array( $staging ) || empty( $staging['verified_on'] ) ) {
			return null;
		}
		$user                 = get_userdata( (int) ( $staging['user_id'] ?? 0 ) );
		$staging['user_name'] = $user ? (string) $user->display_name : null;
		return $staging;
	}

	/**
	 * Validate and store the operator's staging verification.
	 *
	 * @param array  $input   verified_on (Y-m-d), versions (slug => version),
	 *                        checks (code => bool), note.
	 * @param int    $user_id Administrator.
	 * @param string $today   Site-local date, Y-m-d.
	 * @return array|\WP_Error The stored record, or invalid_staging_verification
	 *                         with the invalid `fields`.
	 */
	public static function record_staging_verification( array $input, $user_id, $today ) {
		$invalid = array();

		$verified_on = (string) ( $input['verified_on'] ?? '' );
		$date        = \DateTime::createFromFormat( '!Y-m-d', $verified_on );
		if ( ! $date || $date->format( 'Y-m-d' ) !== $verified_on || $verified_on > (string) $today ) {
			$invalid[] = 'verified_on';
		}

		$versions = array();
		foreach ( array_keys( self::INTERMEDIATE_VERSIONS ) as $slug ) {
			$version = trim( (string) ( $input['versions'][ $slug ] ?? '' ) );
			if ( '' === $version ) {
				$versions[ $slug ] = null;
				continue;
			}
			if ( strlen( $version ) > 40 || ! preg_match( '/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/', $version ) ) {
				$invalid[] = 'versions.' . $slug;
				continue;
			}
			$versions[ $slug ] = $version;
		}
		if ( null === $versions['fair-events'] && ! in_array( 'versions.fair-events', $invalid, true ) ) {
			$invalid[] = 'versions.fair-events';
		}

		$checks = array();
		foreach ( self::STAGING_CHECKS as $check ) {
			$checks[ $check ] = ! empty( $input['checks'][ $check ] );
		}

		$note = trim( (string) ( $input['note'] ?? '' ) );
		if ( function_exists( 'mb_strlen' ) ? mb_strlen( $note ) > self::NOTE_MAX_LENGTH : strlen( $note ) > self::NOTE_MAX_LENGTH ) {
			$invalid[] = 'note';
		}

		if ( $invalid ) {
			return new \WP_Error(
				'invalid_staging_verification',
				'The staging verification has invalid fields.',
				array(
					'status' => 400,
					'fields' => $invalid,
				)
			);
		}

		$record = array(
			'verified_on' => $verified_on,
			'versions'    => $versions,
			'checks'      => $checks,
			'note'        => $note,
			'user_id'     => (int) $user_id,
			'recorded_at' => gmdate( 'Y-m-d H:i:s' ),
		);
		update_option( self::STAGING_OPTION, $record, false );
		return self::get_staging_verification();
	}

	/**
	 * Readable labels for the refusal blockers, keyed by code.
	 *
	 * @return array<string, string>
	 */
	public static function refusal_labels() {
		return array(
			'storage_unavailable'         => __( 'The payment history migration’s records are missing: Fair Events 2.2.0 hasn’t run on this site.', 'fair-events' ),
			'ownership_cutover_missing'   => __( 'Payment records were not switched to Fair Events.', 'fair-events' ),
			'readers_missing'             => __( 'Statistics were not switched to Fair Events records.', 'fair-events' ),
			'migration_unverified'        => __( 'The migration has no clean verification.', 'fair-events' ),
			'migration_work_outstanding'  => __( 'Some payment records still wait to be moved.', 'fair-events' ),
			'findings_open'               => __( 'Some migration findings are still open.', 'fair-events' ),
			'source_history_found'        => __( 'This site has earlier payments, registrations or activity choices that need the migration.', 'fair-events' ),
			'source_history_unverifiable' => __( 'Fair Events couldn’t read every earlier payment or registration record, so it can’t confirm that nothing needs migrating.', 'fair-events' ),
		);
	}

	/**
	 * The steps back to a supported state, in order.
	 *
	 * @return string[]
	 */
	public static function recovery_steps() {
		$versions = self::INTERMEDIATE_VERSIONS;
		return array(
			sprintf(
				/* translators: 1: Fair Payments Connector version, 2: Fair Events version, 3: Fair Audience version, 4: release name */
				__( 'Back up the database, then reinstall Fair Payments Connector %1$s, Fair Events %2$s and Fair Audience %3$s, in that order, from the %4$s release.', 'fair-events' ),
				$versions['fair-payments-connector'],
				$versions['fair-events'],
				$versions['fair-audience'],
				self::INTERMEDIATE_RELEASE
			),
			__( 'On Fair Events → Payment history, finish the migration: verify it, switch payment records and then statistics to Fair Events, and resolve every open finding.', 'fair-events' ),
			__( 'Update Fair Payments Connector, Fair Events and Fair Audience again, in that order.', 'fair-events' ),
		);
	}

	/**
	 * Explain to administrators why Fair Events didn't start, and how to
	 * get back to a supported state.
	 *
	 * @return void
	 */
	public static function render_refusal_notice() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$labels = self::refusal_labels();
		echo '<div class="notice notice-error"><p><strong>';
		echo esc_html__( 'Fair Events is paused: this site hasn’t finished the payment history migration.', 'fair-events' );
		echo '</strong></p><p>';
		echo esc_html__( 'This version no longer includes the migration, so it doesn’t start on a site with earlier payment history. Nothing on this site was changed. Purchases can’t be made until the steps below are done.', 'fair-events' );
		echo '</p><ul style="list-style:disc;padding-left:2em">';
		foreach ( self::$blockers as $code ) {
			echo '<li>' . esc_html( $labels[ $code ] ?? $code ) . '</li>';
		}
		echo '</ul><ol>';
		foreach ( self::recovery_steps() as $step ) {
			echo '<li>' . esc_html( $step ) . '</li>';
		}
		echo '</ol><p>';
		printf(
			'<a href="%1$s">%2$s</a> · <a href="%3$s">%4$s</a>',
			esc_url( self::INTERMEDIATE_RELEASE_URL ),
			esc_html__( 'Download the release', 'fair-events' ),
			esc_url( self::GUIDE_URL ),
			esc_html__( 'Read the upgrade guide', 'fair-events' )
		);
		echo '</p></div>';
	}

	/**
	 * Forget this request's decision, e.g. in tests.
	 *
	 * @return void
	 */
	public static function reset() {
		self::$allowed  = null;
		self::$blockers = array();
		self::$history  = null;
	}
}
