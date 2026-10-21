<?php
/**
 * Bounded log of individual Meta Conversions API requests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag,WordPress.DB.DirectDatabaseQuery

/**
 * One row per request sent to Meta — administrator tests, immediate clicks
 * and every queued retry — pairing the {@see RequestDiagnostics} snapshot
 * with Meta's sanitized answer.
 *
 * The log is diagnostic only: the outbox stays authoritative for delivery
 * state and retries, nothing here is ever resent, and every write is best
 * effort, so a failing log never changes a send or its classification.
 */
class DeliveryAttempts {
	public const TABLE_SUFFIX = 'fair_events_meta_attempts';

	/** Days an attempt is kept. */
	public const RETENTION_DAYS = 30;

	/** Most attempts kept site-wide. */
	public const MAX_ATTEMPTS = 1000;

	/** Allowed `origin` values: who triggered the send. */
	public const ORIGINS = array( 'admin_test', 'production' );

	/** Allowed `delivery_path` values. */
	public const PATHS = array( 'test', 'immediate', 'queued' );

	/** @return string */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Install or upgrade the table. `outcome` stays empty until Meta's answer
	 * is recorded, so an attempt interrupted in between reads as
	 * "result unavailable" rather than as a failure.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				outbox_id bigint(20) unsigned DEFAULT NULL,
				origin varchar(20) NOT NULL,
				delivery_path varchar(20) NOT NULL,
				event_name varchar(64) NOT NULL DEFAULT '',
				attempt_number smallint(5) unsigned NOT NULL DEFAULT 1,
				payment_mode varchar(4) NOT NULL DEFAULT '',
				test_events tinyint(1) unsigned NOT NULL DEFAULT 0,
				request longtext DEFAULT NULL,
				outcome varchar(32) NOT NULL DEFAULT '',
				result_code varchar(40) NOT NULL DEFAULT '',
				result_type varchar(80) NOT NULL DEFAULT '',
				response text DEFAULT NULL,
				created_at datetime NOT NULL,
				finished_at datetime DEFAULT NULL,
				PRIMARY KEY  (id),
				KEY outbox (outbox_id),
				KEY retention (created_at),
				KEY origin_event (origin,event_name)
			) {$charset};"
		);
	}

	/**
	 * Record a request just before it is sent.
	 *
	 * @param array      $context `origin`, `delivery_path`, `event_name`,
	 *                            `attempt_number`, `payment_mode`,
	 *                            `test_events` and an optional `outbox_id`.
	 * @param array|null $request {@see RequestDiagnostics::capture()} result.
	 * @return int Attempt ID, or 0 when it could not be recorded.
	 */
	public function start( $context, $request ) {
		global $wpdb;
		try {
			$encoded  = is_array( $request ) ? wp_json_encode( $request ) : null;
			$inserted = $wpdb->insert(
				self::table_name(),
				array(
					'outbox_id'      => ! empty( $context['outbox_id'] ) ? (int) $context['outbox_id'] : null,
					'origin'         => in_array( $context['origin'] ?? '', self::ORIGINS, true ) ? $context['origin'] : 'production',
					'delivery_path'  => in_array( $context['delivery_path'] ?? '', self::PATHS, true ) ? $context['delivery_path'] : 'queued',
					'event_name'     => preg_match( '/^[A-Za-z][A-Za-z0-9_]{0,63}$/', (string) ( $context['event_name'] ?? '' ) ) ? $context['event_name'] : '',
					'attempt_number' => max( 1, min( 65535, (int) ( $context['attempt_number'] ?? 1 ) ) ),
					'payment_mode'   => in_array( $context['payment_mode'] ?? '', array( 'test', 'live' ), true ) ? $context['payment_mode'] : '',
					'test_events'    => empty( $context['test_events'] ) ? 0 : 1,
					// An oversized or unencodable snapshot is dropped, not the attempt.
					'request'        => is_string( $encoded ) && strlen( $encoded ) <= RequestDiagnostics::MAX_BYTES ? $encoded : null,
					'created_at'     => current_time( 'mysql', true ),
				),
				array( '%d', '%s', '%s', '%s', '%d', '%s', '%d', '%s', '%s' )
			);
			if ( ! $inserted ) {
				return 0;
			}
			$id = (int) $wpdb->insert_id;
			$this->prune();
			return $id;
		} catch ( \Throwable $e ) {
			return 0;
		}
	}

	/**
	 * Attach Meta's answer to a recorded attempt.
	 *
	 * @param int   $id     Attempt ID from {@see start()}; 0 does nothing.
	 * @param array $result {@see Conversions::send_payload()} result.
	 */
	public function finish( $id, $result ) {
		global $wpdb;
		if ( ! $id ) {
			return;
		}
		try {
			$wpdb->update(
				self::table_name(),
				array(
					'outcome'     => sanitize_key( (string) $result['outcome'] ),
					'result_code' => sanitize_key( (string) $result['code'] ),
					'result_type' => sanitize_key( (string) $result['type'] ),
					'response'    => self::encode_response( $result['diagnostics'] ?? null ),
					'finished_at' => current_time( 'mysql', true ),
				),
				array( 'id' => (int) $id ),
				array( '%s', '%s', '%s', '%s', '%s' ),
				array( '%d' )
			);
		} catch ( \Throwable $e ) {
			return;
		}
	}

	/**
	 * A page of unexpired attempts, newest first.
	 *
	 * @param array $args `page`, `per_page`, and optional `origin` and `event_name` filters.
	 * @return array `items` and `total`.
	 */
	public function query( $args ) {
		global $wpdb;
		$where  = 'created_at >= %s';
		$values = array( self::cutoff() );
		if ( ! empty( $args['origin'] ) && in_array( $args['origin'], self::ORIGINS, true ) ) {
			$where   .= ' AND origin = %s';
			$values[] = $args['origin'];
		}
		if ( ! empty( $args['event_name'] ) ) {
			$where   .= ' AND event_name = %s';
			$values[] = (string) $args['event_name'];
		}
		$per_page = max( 1, (int) $args['per_page'] );
		$offset   = ( max( 1, (int) $args['page'] ) - 1 ) * $per_page;
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where holds only fixed SQL and placeholders, filled by the spread values.
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE $where", self::table_name(), ...$values ) );
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE $where ORDER BY id DESC LIMIT %d OFFSET %d",
				self::table_name(),
				...array_merge( $values, array( $per_page, $offset ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		return array(
			'items' => array_map( array( self::class, 'present' ), $rows ? $rows : array() ),
			'total' => $total,
		);
	}

	/**
	 * Unexpired attempts per outbox row.
	 *
	 * @param int[] $outbox_ids Outbox row IDs.
	 * @return array<int,int> Count by outbox row ID.
	 */
	public function counts_for_outbox( $outbox_ids ) {
		global $wpdb;
		$outbox_ids = array_values( array_filter( array_map( 'intval', $outbox_ids ) ) );
		if ( ! $outbox_ids ) {
			return array();
		}
		$placeholders = implode( ', ', array_fill( 0, count( $outbox_ids ), '%d' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a fixed run of %d tokens, one per spread ID.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT outbox_id, COUNT(*) AS total FROM %i WHERE created_at >= %s AND outbox_id IN ($placeholders) GROUP BY outbox_id",
				self::table_name(),
				self::cutoff(),
				...$outbox_ids
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		$counts = array();
		foreach ( $rows ? $rows : array() as $row ) {
			$counts[ (int) $row->outbox_id ] = (int) $row->total;
		}
		return $counts;
	}

	/**
	 * The REST shape of a stored attempt: only validated fields.
	 *
	 * @param array $row Attempt row.
	 * @return array
	 */
	public static function present( $row ) {
		$response = isset( $row['response'] ) ? json_decode( (string) $row['response'], true ) : null;
		$request  = isset( $row['request'] ) ? RequestDiagnostics::from_storage( json_decode( (string) $row['request'], true ) ) : null;
		return array(
			'id'               => (int) $row['id'],
			'origin'           => (string) $row['origin'],
			'delivery_path'    => (string) $row['delivery_path'],
			'event_name'       => (string) $row['event_name'],
			'attempt_number'   => (int) $row['attempt_number'],
			'payment_mode'     => (string) $row['payment_mode'],
			'test_events'      => (bool) (int) $row['test_events'],
			'outcome'          => '' === (string) $row['outcome'] ? null : (string) $row['outcome'],
			'code'             => (string) $row['result_code'],
			'type'             => (string) $row['result_type'],
			'response'         => is_array( $response ) ? self::allowlisted_response( $response ) : null,
			'request'          => $request,
			'created_at'       => (string) $row['created_at'],
			'created_at_local' => wp_date(
				get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
				strtotime( $row['created_at'] . ' UTC' )
			),
		);
	}

	/** Delete attempts past {@see RETENTION_DAYS} and beyond the newest {@see MAX_ATTEMPTS}. */
	public function prune() {
		global $wpdb;
		try {
			$table = self::table_name();
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s', $table, self::cutoff() ) );
			$oldest_kept = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i ORDER BY id DESC LIMIT 1 OFFSET %d', $table, self::MAX_ATTEMPTS - 1 ) );
			if ( $oldest_kept ) {
				$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE id < %d', $table, (int) $oldest_kept ) );
			}
		} catch ( \Throwable $e ) {
			return;
		}
	}

	/** @return string UTC time before which attempts have expired. */
	private static function cutoff() {
		return gmdate( 'Y-m-d H:i:s', time() - self::RETENTION_DAYS * DAY_IN_SECONDS );
	}

	/** @param array|null $diagnostics {@see Conversions::diagnostics_from()} result. @return string|null */
	private static function encode_response( $diagnostics ) {
		if ( ! is_array( $diagnostics ) ) {
			return null;
		}
		$encoded = wp_json_encode( self::allowlisted_response( $diagnostics ) );
		return is_string( $encoded ) ? $encoded : null;
	}

	/** @param array $diagnostics Diagnostics. @return array Only the allowlisted keys. */
	private static function allowlisted_response( $diagnostics ) {
		$messages = isset( $diagnostics['messages'] ) && is_array( $diagnostics['messages'] )
			? array_values( array_filter( $diagnostics['messages'], 'is_string' ) )
			: null;
		return array(
			'http_status'     => isset( $diagnostics['http_status'] ) && is_int( $diagnostics['http_status'] ) ? $diagnostics['http_status'] : null,
			'events_received' => isset( $diagnostics['events_received'] ) && is_int( $diagnostics['events_received'] ) ? $diagnostics['events_received'] : null,
			'messages'        => $messages,
			'fbtrace_id'      => isset( $diagnostics['fbtrace_id'] ) && is_string( $diagnostics['fbtrace_id'] ) ? $diagnostics['fbtrace_id'] : null,
		);
	}
}
