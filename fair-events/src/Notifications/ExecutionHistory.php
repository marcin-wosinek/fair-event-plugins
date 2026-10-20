<?php
/**
 * Notification execution history.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * One row per notification execution: a scheduled send of one
 * configuration's occurrence, or one test request. Its deliveries are kept in
 * {@see DeliveryHistory}.
 *
 * A scheduled execution has a unique source key per configuration and
 * occurrence, so repeated or overlapping cron runs of the same occurrence
 * share one row. Concluding an execution recounts its deliveries, and an
 * outcome without deliveries (a skip, a configuration failure) only applies
 * while it has none: a later run can never replace a delivery-based result
 * with a skip. Duplicate prevention itself stays with {@see DeliveryLog}.
 *
 * An execution is running until it concludes. Each recorded delivery renews
 * its heartbeat; one whose heartbeat is older than the lease was abandoned —
 * the request stopped — and its unsettled deliveries stay unknown.
 *
 * Rows hold the configuration's name and channel as they were when it ran,
 * so history stays readable after the configuration changes or is gone.
 * Records imported from before this history existed are marked legacy
 * ({@see HistoryMigration}); their missing details stay missing.
 */
class ExecutionHistory {
	public const TABLE_SUFFIX     = 'fair_events_notification_executions';
	public const LEASE_SECONDS    = 900;
	public const RETENTION_DAYS   = 365;
	public const COMPLETE         = 'complete';
	public const LEGACY           = 'legacy';
	private const MAX_REASON_CODE = 40;

	/**
	 * What each channel's delivery counts count.
	 */
	public const COUNT_UNITS = array(
		Configurations::TELEGRAM         => 'message_parts',
		Configurations::BULK_EMAIL       => 'recipients',
		Configurations::INDIVIDUAL_EMAIL => 'recipients',
	);

	/**
	 * Delivery rows.
	 *
	 * @var DeliveryHistory
	 */
	private $deliveries;

	/**
	 * Constructor.
	 *
	 * @param DeliveryHistory|null $deliveries Delivery rows.
	 */
	public function __construct( $deliveries = null ) {
		$this->deliveries = $deliveries ? $deliveries : new DeliveryHistory();
	}

	/**
	 * Full table name.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Table definition for dbDelta.
	 *
	 * @param string $charset Charset and collation clause.
	 * @return string
	 */
	public static function schema( $charset ) {
		$table = self::table_name();
		return "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			source_key varchar(150) DEFAULT NULL,
			config_id varchar(36) NOT NULL DEFAULT '',
			config_name varchar(100) NOT NULL DEFAULT '',
			name_source varchar(20) NOT NULL DEFAULT '',
			channel varchar(20) NOT NULL,
			origin varchar(10) NOT NULL,
			occurrence varchar(10) NOT NULL DEFAULT '',
			week_start date DEFAULT NULL,
			week_end date DEFAULT NULL,
			lifecycle varchar(20) NOT NULL,
			outcome varchar(20) NOT NULL DEFAULT '',
			reason_code varchar(40) NOT NULL DEFAULT '',
			count_unit varchar(20) NOT NULL DEFAULT '',
			accepted_count int(10) unsigned DEFAULT NULL,
			failed_count int(10) unsigned DEFAULT NULL,
			skipped_count int(10) unsigned DEFAULT NULL,
			unknown_count int(10) unsigned DEFAULT NULL,
			completeness varchar(20) NOT NULL DEFAULT 'complete',
			legacy_status varchar(30) NOT NULL DEFAULT '',
			legacy_message varchar(255) NOT NULL DEFAULT '',
			started_at datetime NOT NULL,
			finished_at datetime DEFAULT NULL,
			heartbeat_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY source_key (source_key),
			KEY started (started_at,id),
			KEY configuration_started (config_id,started_at,id),
			KEY channel_started (channel,started_at,id),
			KEY outcome_started (outcome,started_at,id),
			KEY lifecycle_heartbeat (lifecycle,heartbeat_at)
		) {$charset};";
	}

	/**
	 * The source key of a scheduled occurrence.
	 *
	 * @param string $config_id  Configuration ID.
	 * @param string $occurrence Week the send was scheduled for.
	 * @return string
	 */
	public static function scheduled_key( $config_id, $occurrence ) {
		return 'scheduled|' . $config_id . '|' . $occurrence;
	}

	/**
	 * Start recording an execution.
	 *
	 * @param array $execution config_id, channel, origin, occurrence and,
	 *                         when known, week_start and week_end.
	 * @return array{id: int, created: bool} The execution, and whether this
	 *     call created it rather than finding a scheduled one already there.
	 *     ID 0 while the history tables are not installed.
	 */
	public function begin( array $execution ) {
		if ( ! HistoryTables::is_current() ) {
			return array(
				'id'      => 0,
				'created' => false,
			);
		}

		$config_id = (string) $execution['config_id'];
		$record    = Configurations::get( $config_id );
		$now       = current_time( 'mysql', true );
		$key       = HistoryOutcome::SCHEDULED === $execution['origin']
			? self::scheduled_key( $config_id, (string) $execution['occurrence'] )
			: null;

		$id = HistoryTables::insert_ignore(
			self::table_name(),
			array(
				'source_key'   => $key,
				'config_id'    => $config_id,
				'config_name'  => $record ? mb_substr( (string) $record['name'], 0, Configurations::MAX_NAME_LENGTH ) : '',
				'name_source'  => 'snapshot',
				'channel'      => (string) $execution['channel'],
				'origin'       => (string) $execution['origin'],
				'occurrence'   => (string) ( $execution['occurrence'] ?? '' ),
				'week_start'   => ! empty( $execution['week_start'] ) ? (string) $execution['week_start'] : null,
				'week_end'     => ! empty( $execution['week_end'] ) ? (string) $execution['week_end'] : null,
				'lifecycle'    => HistoryOutcome::RUNNING,
				'count_unit'   => self::COUNT_UNITS[ $execution['channel'] ] ?? '',
				'completeness' => self::COMPLETE,
				'started_at'   => $now,
				'heartbeat_at' => $now,
			)
		);
		if ( $id ) {
			return array(
				'id'      => $id,
				'created' => true,
			);
		}

		global $wpdb;
		$existing = null !== $key
			? (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE source_key = %s', self::table_name(), $key ) )
			: 0;
		return array(
			'id'      => $existing,
			'created' => false,
		);
	}

	/**
	 * Fill in the covered week once it is known.
	 *
	 * @param int   $id   Execution ID.
	 * @param array $week Week with 'start' and 'end'.
	 * @return void
	 */
	public function cover( $id, array $week ) {
		if ( ! $id || empty( $week['start'] ) || empty( $week['end'] ) ) {
			return;
		}
		global $wpdb;
		$wpdb->update(
			self::table_name(),
			array(
				'week_start' => $week['start'],
				'week_end'   => $week['end'],
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Record a delivery about to be attempted. Its outcome is unknown until settled.
	 *
	 * @param int   $id       Execution ID.
	 * @param array $delivery recipient, recipient_name, part, part_count.
	 * @return int Delivery ID.
	 */
	public function attempt( $id, array $delivery ) {
		if ( ! $id ) {
			return 0;
		}
		$now = current_time( 'mysql', true );
		$this->heartbeat( $id );
		return $this->deliveries->insert(
			$id,
			array_merge(
				$delivery,
				array(
					'outcome'      => HistoryOutcome::UNKNOWN,
					'reason_code'  => '',
					'attempted_at' => $now,
					'finished_at'  => null,
				)
			)
		);
	}

	/**
	 * Record an attempted delivery's outcome.
	 *
	 * @param int    $id          Execution ID.
	 * @param int    $delivery_id Delivery ID.
	 * @param string $outcome     Delivery outcome.
	 * @param string $reason      Safe reason code.
	 * @return void
	 */
	public function settle( $id, $delivery_id, $outcome, $reason = '' ) {
		if ( ! $id || ! $delivery_id ) {
			return;
		}
		$this->deliveries->settle( $delivery_id, $outcome, $reason );
		$this->heartbeat( $id );
	}

	/**
	 * Record a delivery that was not attempted, e.g. a recipient without consent.
	 *
	 * @param int   $id       Execution ID.
	 * @param array $delivery recipient, recipient_name, part, part_count, outcome, reason_code.
	 * @return void
	 */
	public function note( $id, array $delivery ) {
		if ( ! $id ) {
			return;
		}
		$this->heartbeat( $id );
		$this->deliveries->insert(
			$id,
			array_merge(
				$delivery,
				array(
					'attempted_at' => null,
					'finished_at'  => current_time( 'mysql', true ),
				)
			)
		);
	}

	/**
	 * Finish an execution: recount its deliveries and set its outcome.
	 *
	 * @param int    $id       Execution ID.
	 * @param string $fallback Outcome when it has no delivery, e.g. skipped.
	 * @param string $reason   Reason code for that outcome.
	 * @return void
	 */
	public function conclude( $id, $fallback = HistoryOutcome::SKIPPED, $reason = '' ) {
		if ( ! $id ) {
			return;
		}
		$this->settle_execution( $id, HistoryOutcome::COMPLETED, $fallback, $reason );
	}

	/**
	 * Mark running executions whose heartbeat is past the lease as abandoned.
	 *
	 * Deliveries still waiting for their outcome keep it unknown.
	 *
	 * @return void
	 */
	public function reconcile() {
		if ( ! HistoryTables::is_current() ) {
			return;
		}
		global $wpdb;
		$stale = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE lifecycle = %s AND heartbeat_at < %s',
				self::table_name(),
				HistoryOutcome::RUNNING,
				gmdate( 'Y-m-d H:i:s', time() - self::LEASE_SECONDS )
			)
		);
		foreach ( $stale ? $stale : array() as $id ) {
			$this->deliveries->interrupt( (int) $id );
			$this->settle_execution( (int) $id, HistoryOutcome::ABANDONED, HistoryOutcome::UNKNOWN, 'interrupted' );
		}
	}

	/**
	 * Recount an execution and close it.
	 *
	 * @param int    $id        Execution ID.
	 * @param string $lifecycle Completed or abandoned.
	 * @param string $fallback  Outcome when it has no delivery.
	 * @param string $reason    Reason code for that outcome.
	 * @return void
	 */
	private function settle_execution( $id, $lifecycle, $fallback, $reason ) {
		global $wpdb;
		$counts    = $this->deliveries->counts( $id );
		$attempted = $counts[ HistoryOutcome::ACCEPTED ] + $counts[ HistoryOutcome::FAILED ] + $counts[ HistoryOutcome::UNKNOWN ];
		$outcome   = HistoryOutcome::aggregate( $counts, $fallback );

		$wpdb->update(
			self::table_name(),
			array(
				'lifecycle'      => $lifecycle,
				'outcome'        => $outcome,
				'reason_code'    => $attempted ? '' : substr( sanitize_key( $reason ), 0, self::MAX_REASON_CODE ),
				'accepted_count' => $counts[ HistoryOutcome::ACCEPTED ],
				'failed_count'   => $counts[ HistoryOutcome::FAILED ],
				'skipped_count'  => $counts[ HistoryOutcome::SKIPPED ],
				'unknown_count'  => $counts[ HistoryOutcome::UNKNOWN ],
				'finished_at'    => current_time( 'mysql', true ),
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Renew a running execution's lease.
	 *
	 * @param int $id Execution ID.
	 * @return void
	 */
	private function heartbeat( $id ) {
		global $wpdb;
		$wpdb->update(
			self::table_name(),
			array( 'heartbeat_at' => current_time( 'mysql', true ) ),
			array( 'id' => (int) $id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * One page of executions, newest first.
	 *
	 * @param array $filters  config_id, channel, origin, outcome, after and
	 *                        before (UTC 'Y-m-d H:i:s', on the start time).
	 * @param int   $page     1-based page.
	 * @param int   $per_page Page size.
	 * @return array{items: array[], total: int}
	 */
	public function query( array $filters, $page, $per_page ) {
		global $wpdb;
		$this->reconcile();

		$where  = array( '1 = 1' );
		$values = array( self::table_name() );
		$exact  = array(
			'config_id' => 'config_id',
			'channel'   => 'channel',
			'origin'    => 'origin',
			'outcome'   => 'outcome',
		);
		foreach ( $exact as $filter => $column ) {
			if ( isset( $filters[ $filter ] ) && '' !== $filters[ $filter ] ) {
				$where[]  = '%i = %s';
				$values[] = $column;
				$values[] = (string) $filters[ $filter ];
			}
		}
		if ( ! empty( $filters['after'] ) ) {
			$where[]  = 'started_at >= %s';
			$values[] = $filters['after'];
		}
		if ( ! empty( $filters['before'] ) ) {
			$where[]  = 'started_at < %s';
			$values[] = $filters['before'];
		}
		$condition = implode( ' AND ', $where );

		// The condition holds placeholders only; its values are passed along.
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE {$condition}", $values ) );
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE {$condition} ORDER BY started_at DESC, id DESC LIMIT %d OFFSET %d",
				array_merge( $values, array( (int) $per_page, ( (int) $page - 1 ) * (int) $per_page ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array(
			'items' => array_map( array( $this, 'hydrate' ), $rows ? $rows : array() ),
			'total' => $total,
		);
	}

	/**
	 * The newest execution of each configuration, in one query.
	 *
	 * @param string[] $config_ids Configuration IDs.
	 * @return array[] Execution rows by configuration ID; a configuration
	 *     without any execution is left out.
	 */
	public function latest( array $config_ids ) {
		$config_ids = array_values( array_unique( array_map( 'strval', $config_ids ) ) );
		if ( ! $config_ids || ! HistoryTables::is_current() ) {
			return array();
		}
		global $wpdb;
		$this->reconcile();

		$placeholders = implode( ', ', array_fill( 0, count( $config_ids ), '%s' ) );
		// The newest row is the one no other row of its configuration
		// started after, ties broken by ID as in query().
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT e.* FROM %i e WHERE e.config_id IN ( {$placeholders} ) AND NOT EXISTS ( SELECT 1 FROM %i n WHERE n.config_id = e.config_id AND ( n.started_at > e.started_at OR ( n.started_at = e.started_at AND n.id > e.id ) ) )",
				array_merge( array( self::table_name() ), $config_ids, array( self::table_name() ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		$latest = array();
		foreach ( $rows ? $rows : array() as $row ) {
			$latest[ $row['config_id'] ] = $this->hydrate( $row );
		}
		return $latest;
	}

	/**
	 * One execution.
	 *
	 * @param int $id Execution ID.
	 * @return array|null
	 */
	public function get( $id ) {
		global $wpdb;
		$this->reconcile();
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table_name(), (int) $id ), ARRAY_A );
		return $row ? $this->hydrate( $row ) : null;
	}

	/**
	 * One page of an execution's deliveries.
	 *
	 * @param int $id       Execution ID.
	 * @param int $page     1-based page.
	 * @param int $per_page Page size.
	 * @return array{items: array[], total: int}
	 */
	public function deliveries( $id, $page, $per_page ) {
		return $this->deliveries->for_execution( $id, $page, $per_page );
	}

	/**
	 * Typed execution row; a running execution's counts are counted now.
	 *
	 * @param array $row Database row.
	 * @return array
	 */
	private function hydrate( array $row ) {
		if ( HistoryOutcome::RUNNING === $row['lifecycle'] ) {
			$counts                = $this->deliveries->counts( (int) $row['id'] );
			$row['accepted_count'] = $counts[ HistoryOutcome::ACCEPTED ];
			$row['failed_count']   = $counts[ HistoryOutcome::FAILED ];
			$row['skipped_count']  = $counts[ HistoryOutcome::SKIPPED ];
			$row['unknown_count']  = $counts[ HistoryOutcome::UNKNOWN ];
		}
		foreach ( array( 'accepted_count', 'failed_count', 'skipped_count', 'unknown_count' ) as $column ) {
			$row[ $column ] = null === $row[ $column ] ? null : (int) $row[ $column ];
		}
		$row['id'] = (int) $row['id'];
		return $row;
	}

	/**
	 * Delete executions and their deliveries past the retention period.
	 *
	 * Delivery claims ({@see DeliveryLog}) are not touched.
	 *
	 * @return void
	 */
	public function cleanup() {
		if ( ! HistoryTables::is_current() ) {
			return;
		}
		global $wpdb;
		$before = gmdate( 'Y-m-d H:i:s', time() - self::RETENTION_DAYS * DAY_IN_SECONDS );
		$this->deliveries->delete_before( $before );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE started_at < %s', self::table_name(), $before ) );
	}
}
