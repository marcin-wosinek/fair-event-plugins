<?php
/**
 * Imports notification history kept before the execution history existed.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Copies each type's retained run records and delivery records into the
 * execution history, once per type.
 *
 * Before the execution history, each configuration kept its last runs in an
 * option and each delivery claim a row in {@see DeliveryLog}. This imports
 * what was recorded before the history tables were created
 * ({@see HistoryTables::since()}); later sends are recorded directly.
 *
 * - Each retained run becomes a legacy execution with its original status,
 *   message and counts. Nothing it did not record is added: no recipients,
 *   attempt times or confirmed delivery. Counts it did not have stay
 *   unknown. Telegram runs counted destinations, not message parts.
 * - Telegram and individual email delivery records become legacy
 *   deliveries of the run of the same configuration and week. Records
 *   without such a run, and bulk email claims, which stand for a whole send
 *   rather than a recipient, are kept as legacy executions of their own with
 *   an unknown outcome.
 * - The configuration's name is today's, marked as a migration-time
 *   fallback: names were not recorded with the runs.
 *
 * Every record has a stable source key, so a repeated or interrupted run
 * adds nothing twice. A type is marked done only after every record was
 * found in the history. Nothing is sent and no delivery claim changes.
 *
 * Call while holding {@see Lock::MIGRATION}.
 */
class HistoryMigration {
	public const VERSION = '1';
	public const OPTION  = 'fair_events_notification_history_migration';

	/**
	 * Delivery record provider per type.
	 */
	private const PROVIDERS = array(
		Configurations::TELEGRAM         => TelegramProvider::ID,
		Configurations::BULK_EMAIL       => BulkEmailDispatcher::PROVIDER,
		Configurations::INDIVIDUAL_EMAIL => IndividualEmailDispatcher::PROVIDER,
	);

	/**
	 * Execution outcome and reason of each former run status.
	 */
	private const STATUSES = array(
		'sent'                => array( HistoryOutcome::SUCCESS, '' ),
		'partial'             => array( HistoryOutcome::PARTIAL, '' ),
		'failed'              => array( HistoryOutcome::FAILURE, '' ),
		'skipped_empty'       => array( HistoryOutcome::SKIPPED, 'no_events' ),
		'expired'             => array( HistoryOutcome::SKIPPED, 'expired' ),
		'suspended'           => array( HistoryOutcome::SKIPPED, 'fair_audience_unavailable' ),
		'configuration_error' => array( HistoryOutcome::FAILURE, 'configuration_error' ),
	);

	/**
	 * Import every type that is ready and not imported yet.
	 *
	 * @return void
	 */
	public static function run() {
		if ( ! HistoryTables::is_current() ) {
			return;
		}
		foreach ( Configurations::TYPES as $type ) {
			if ( ! self::is_migrated( $type ) && ConfigurationMigration::is_migrated( $type ) ) {
				$details = self::migrate( $type );
				if ( null !== $details ) {
					self::mark_migrated( $type, $details );
				}
			}
		}
	}

	/**
	 * Whether every type was imported.
	 *
	 * @return bool
	 */
	public static function is_complete() {
		foreach ( Configurations::TYPES as $type ) {
			if ( ! self::is_migrated( $type ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Whether a type was imported at the current version.
	 *
	 * @param string $type Notification type.
	 * @return bool
	 */
	public static function is_migrated( $type ) {
		$state = get_option( self::OPTION, array() );
		return is_array( $state ) && self::VERSION === ( $state[ $type ]['version'] ?? null );
	}

	/**
	 * Import one type's history.
	 *
	 * @param string $type Notification type.
	 * @return array|null What was imported, or null when it could not be verified.
	 */
	public static function migrate( $type ) {
		$since    = HistoryTables::since();
		$expected = array(
			'executions' => array(),
			'deliveries' => array(),
		);
		$runs     = array();

		foreach ( Configurations::all( $type ) as $configuration ) {
			$stored = get_option( Configurations::option( $configuration['id'], 'runs' ), array() );
			foreach ( is_array( $stored ) ? $stored : array() as $key => $run ) {
				if ( ! is_array( $run ) || ( '' !== $since && (string) ( $run['time'] ?? '' ) >= $since ) ) {
					continue;
				}
				$source_key = 'legacy-run|' . $configuration['id'] . '|' . $key;
				self::import_run( $type, $configuration, (string) $key, $run, $source_key );
				$expected['executions'][]                           = $source_key;
				$runs[ $configuration['id'] . '|' . (string) $key ] = array(
					'source_key' => $source_key,
					'run'        => $run,
				);
			}
		}

		foreach ( self::claims( $type, $since ) as $claim ) {
			$key = Configurations::TELEGRAM === $type
				? $claim['week_start']
				: ( new \DateTimeImmutable( $claim['week_start'], new \DateTimeZone( 'UTC' ) ) )->format( 'o-\WW' );
			$run = $runs[ $claim['config_id'] . '|' . $key ] ?? null;

			if ( $run && Configurations::BULK_EMAIL !== $type ) {
				$execution_key = $run['source_key'];
			} elseif ( $run ) {
				// The run already stands for the claim of its send.
				continue;
			} else {
				$execution_key = 'legacy-claims|' . $claim['config_id'] . '|' . $claim['provider'] . '|' . $claim['week_start'];
				self::import_unmatched( $type, $claim, $key, $execution_key );
				$expected['executions'][] = $execution_key;
			}

			if ( Configurations::BULK_EMAIL !== $type ) {
				$delivery_key = 'legacy-delivery|' . $claim['id'];
				$recipient    = Configurations::TELEGRAM === $type ? $claim['destination'] : (string) ( $run['run']['destination'] ?? '' );
				self::import_delivery( $execution_key, $claim, $recipient, $delivery_key );
				$expected['deliveries'][] = $delivery_key;
			}
		}

		$expected['executions'] = array_values( array_unique( $expected['executions'] ) );
		if ( ! self::all_present( ExecutionHistory::table_name(), $expected['executions'] )
			|| ! self::all_present( DeliveryHistory::table_name(), $expected['deliveries'] )
		) {
			return null;
		}

		return array(
			'executions' => count( $expected['executions'] ),
			'deliveries' => count( $expected['deliveries'] ),
		);
	}

	/**
	 * Import a retained run.
	 *
	 * @param string $type          Notification type.
	 * @param array  $configuration Configuration record.
	 * @param string $key           Week the run was recorded under.
	 * @param array  $run           Run record.
	 * @param string $source_key    Source key.
	 * @return void
	 */
	private static function import_run( $type, array $configuration, $key, array $run, $source_key ) {
		$status                   = sanitize_key( (string) ( $run['status'] ?? '' ) );
		list( $outcome, $reason ) = self::STATUSES[ $status ] ?? array( HistoryOutcome::UNKNOWN, '' );
		$counts                   = is_array( $run['counts'] ?? null ) ? $run['counts'] : array();
		$time                     = self::time( $run['time'] ?? '' );

		if ( Configurations::TELEGRAM === $type ) {
			$unit     = $counts ? 'destinations' : '';
			$accepted = $counts['sent'] ?? null;
			$failed   = $counts['failed'] ?? null;
			$skipped  = null;
			$unknown  = $counts['uncertain'] ?? null;
		} else {
			$unit     = $counts ? 'recipients' : '';
			$accepted = $counts['sent'] ?? null;
			$failed   = $counts['failed'] ?? null;
			$skipped  = $counts['skipped'] ?? null;
			$unknown  = null;
		}

		HistoryTables::insert_ignore(
			ExecutionHistory::table_name(),
			array(
				'source_key'     => $source_key,
				'config_id'      => $configuration['id'],
				'config_name'    => (string) $configuration['name'],
				'name_source'    => 'migration_fallback',
				'channel'        => $type,
				'origin'         => HistoryOutcome::SCHEDULED,
				'occurrence'     => self::occurrence( $key ),
				'week_start'     => self::date( $run['week_start'] ?? '' ),
				'week_end'       => self::date( $run['week_end'] ?? '' ),
				'lifecycle'      => HistoryOutcome::COMPLETED,
				'outcome'        => $outcome,
				'reason_code'    => $reason,
				'count_unit'     => $unit,
				'accepted_count' => null === $accepted ? null : (int) $accepted,
				'failed_count'   => null === $failed ? null : (int) $failed,
				'skipped_count'  => null === $skipped ? null : (int) $skipped,
				'unknown_count'  => null === $unknown ? null : (int) $unknown,
				'completeness'   => ExecutionHistory::LEGACY,
				'legacy_status'  => substr( $status, 0, 30 ),
				'legacy_message' => mb_substr( sanitize_text_field( (string) ( $run['message'] ?? '' ) ), 0, 255 ),
				'started_at'     => $time,
				'finished_at'    => $time,
				'heartbeat_at'   => $time,
			)
		);
	}

	/**
	 * Keep a delivery record without a retained run as evidence of its own.
	 *
	 * @param string $type       Notification type.
	 * @param array  $claim      Delivery record row.
	 * @param string $key        Week its run would have been recorded under.
	 * @param string $source_key Source key.
	 * @return void
	 */
	private static function import_unmatched( $type, array $claim, $key, $source_key ) {
		$record = Configurations::get( $claim['config_id'] );
		$bulk   = Configurations::BULK_EMAIL === $type;

		HistoryTables::insert_ignore(
			ExecutionHistory::table_name(),
			array(
				'source_key'     => $source_key,
				'config_id'      => $claim['config_id'],
				'config_name'    => $record ? (string) $record['name'] : '',
				'name_source'    => $record ? 'migration_fallback' : '',
				'channel'        => $type,
				'origin'         => HistoryOutcome::SCHEDULED,
				'occurrence'     => self::occurrence( $key ),
				'week_start'     => Configurations::TELEGRAM === $type ? self::date( $claim['week_start'] ) : null,
				'week_end'       => null,
				'lifecycle'      => HistoryOutcome::COMPLETED,
				'outcome'        => HistoryOutcome::UNKNOWN,
				'reason_code'    => 'legacy_unmatched',
				'count_unit'     => '',
				'accepted_count' => null,
				'failed_count'   => null,
				'skipped_count'  => null,
				'unknown_count'  => null,
				'completeness'   => ExecutionHistory::LEGACY,
				// A bulk email claim records the whole send's state.
				'legacy_status'  => $bulk ? substr( sanitize_key( $claim['state'] ), 0, 30 ) : '',
				'legacy_message' => '',
				'started_at'     => $claim['created_at'],
				'finished_at'    => $claim['updated_at'],
				'heartbeat_at'   => $claim['updated_at'],
			)
		);
	}

	/**
	 * Import a Telegram or individual email delivery record.
	 *
	 * @param string $execution_key Source key of its execution.
	 * @param array  $claim         Delivery record row.
	 * @param string $recipient     Chat or address, '' when not recorded.
	 * @param string $source_key    Source key.
	 * @return void
	 */
	private static function import_delivery( $execution_key, array $claim, $recipient, $source_key ) {
		global $wpdb;
		$execution_id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE source_key = %s', ExecutionHistory::table_name(), $execution_key ) );
		if ( ! $execution_id ) {
			return;
		}
		$outcome = HistoryOutcome::from_state( $claim['state'] );

		( new DeliveryHistory() )->insert(
			$execution_id,
			array(
				'source_key'   => $source_key,
				'recipient'    => $recipient,
				'part'         => (int) $claim['part'],
				'part_count'   => (int) $claim['part_count'],
				'outcome'      => $outcome,
				'reason_code'  => $claim['error_code'],
				'legacy'       => 1,
				// The claim was taken right before the attempt; a skipped part was never attempted.
				'attempted_at' => HistoryOutcome::SKIPPED === $outcome ? null : $claim['created_at'],
				'finished_at'  => 'sending' === $claim['state'] ? null : $claim['updated_at'],
				'created_at'   => $claim['created_at'],
			)
		);
	}

	/**
	 * A type's delivery records from before the history tables.
	 *
	 * @param string $type  Notification type.
	 * @param string $since UTC moment the history tables were created.
	 * @return array[]
	 */
	private static function claims( $type, $since ) {
		global $wpdb;
		if ( ! DeliveryLog::is_current() ) {
			return array();
		}
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id,config_id,week_start,provider,destination,part,part_count,state,error_code,created_at,updated_at FROM %i WHERE provider = %s AND created_at < %s ORDER BY id ASC',
				DeliveryLog::table_name(),
				self::PROVIDERS[ $type ],
				'' !== $since ? $since : '9999-12-31 23:59:59'
			),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * Whether every source key is in a table.
	 *
	 * @param string   $table Table name.
	 * @param string[] $keys  Source keys.
	 * @return bool
	 */
	private static function all_present( $table, array $keys ) {
		global $wpdb;
		foreach ( array_chunk( $keys, 200 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%s' ) );
			$found        = (int) $wpdb->get_var(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- placeholders only.
				$wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE source_key IN ({$placeholders})", array_merge( array( $table ), $chunk ) )
			);
			if ( count( $chunk ) !== $found ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * A week identifier, or '' for anything else.
	 *
	 * @param string $key Run key.
	 * @return string
	 */
	private static function occurrence( $key ) {
		return preg_match( '/^(\d{4}-W\d{2}|\d{4}-\d{2}-\d{2})$/', $key ) ? $key : '';
	}

	/**
	 * A 'Y-m-d' date, or null.
	 *
	 * @param mixed $value Date.
	 * @return string|null
	 */
	private static function date( $value ) {
		return preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $value ) ? (string) $value : null;
	}

	/**
	 * A run's UTC 'Y-m-d H:i:s' time. A run without one was recorded before
	 * the history tables were created, so that moment stands in for it.
	 *
	 * @param mixed $value Time.
	 * @return string
	 */
	private static function time( $value ) {
		if ( preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) $value ) ) {
			return (string) $value;
		}
		return '' !== HistoryTables::since() ? HistoryTables::since() : current_time( 'mysql', true );
	}

	/**
	 * Record that a type was imported.
	 *
	 * @param string $type    Notification type.
	 * @param array  $details What was imported, kept for support.
	 * @return void
	 */
	private static function mark_migrated( $type, array $details ) {
		$state          = get_option( self::OPTION, array() );
		$state          = is_array( $state ) ? $state : array();
		$state[ $type ] = array_merge(
			$details,
			array(
				'version'     => self::VERSION,
				'migrated_at' => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		update_option( self::OPTION, $state, true );
	}
}
