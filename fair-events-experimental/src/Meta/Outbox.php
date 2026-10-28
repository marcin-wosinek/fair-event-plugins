<?php
/**
 * Persistent Meta Conversions delivery outbox.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag,WordPress.DB.DirectDatabaseQuery

/** Stores and claims conversion delivery work. */
class Outbox {
	public const TABLE_SUFFIX = 'fair_events_meta_outbox';
	public const DB_VERSION   = '7';

	/** Seconds a queued claim stays reserved for its worker before it can be recovered. */
	public const LEASE_SECONDS = 300;

	/** Sends allowed per queued row, counting interrupted ones: the first and one per retry delay. */
	public const MAX_ATTEMPTS = 6;

	/** Seconds before each retry, by the attempt that failed. */
	private const RETRY_DELAYS = array( 60, 300, 1800, 7200, 43200 );

	/** Candidates tried by one {@see claim_due()} before it gives way to other workers. */
	private const CLAIM_TRIES = 3;

	/**
	 * State of a reserved immediate send that has not finished — or never
	 * will, when the request was interrupted. Like every `immediate_*`
	 * state it is excluded from {@see claim_due()}, so it is never retried.
	 */
	public const IMMEDIATE_SENDING = 'immediate_sending';

	/** Allowlisted keys of the stored `meta_diagnostics` JSON. */
	private const DIAGNOSTIC_KEYS = array( 'http_status', 'events_received', 'messages', 'fbtrace_id' );

	/** @var bool Whether the last {@see claim_due()} lost every candidate to other workers. */
	private $contended = false;

	/** @var int ID of the row the last {@see insert()} added, or 0. */
	private $inserted_id = 0;

	/** @return string */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Install or upgrade the table. `payment_mode` defaults every pre-existing
	 * row to 'live' — the prior version could only ever enqueue live
	 * transactions, so that default is also the historically correct value.
	 *
	 * Engagement rows (version 3) have no transaction: `transaction_id` is
	 * NULL, which the `logical_conversion` key never treats as a duplicate,
	 * and `delivery_event` keeps each Meta event ID unique instead. dbDelta
	 * does not change a column's nullability, so the upgrade relaxes
	 * `transaction_id` explicitly.
	 *
	 * `event_context` (version 4) holds the JSON snapshot of a checkout or
	 * purchase's event context; rows queued earlier keep NULL and are
	 * delivered without it.
	 *
	 * `meta_diagnostics` (version 5) holds the allowlisted, sanitized
	 * {@see Conversions::diagnostics_from()} JSON of a finished attempt; rows
	 * finished earlier keep NULL and are shown without diagnostics.
	 *
	 * Version 6 adds the {@see DeliveryAttempts} table of sent requests.
	 *
	 * Version 7 adds the `claim_token` and `claim_expires_at` lease of a
	 * queued `sending` row. Rows already `sending` when it is installed get a
	 * full lease from now, so a worker still running old code can finish
	 * before the row is recovered.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				transaction_id bigint(20) unsigned DEFAULT NULL,
				event_post_id bigint(20) unsigned DEFAULT NULL,
				event_date_id bigint(20) unsigned DEFAULT NULL,
				event_name varchar(40) NOT NULL,
				event_id char(64) NOT NULL,
				event_time bigint(20) unsigned NOT NULL,
				source_url text NOT NULL,
				value decimal(12,2) NOT NULL,
				currency char(3) NOT NULL,
				order_id varchar(64) NOT NULL DEFAULT '',
				payment_mode varchar(4) NOT NULL DEFAULT 'live',
				fbp varchar(180) DEFAULT NULL,
				fbc varchar(180) DEFAULT NULL,
				event_context text DEFAULT NULL,
				meta_diagnostics text DEFAULT NULL,
				state varchar(32) NOT NULL DEFAULT 'pending',
				claim_token char(32) DEFAULT NULL,
				claim_expires_at datetime DEFAULT NULL,
				attempt_count smallint(5) unsigned NOT NULL DEFAULT 0,
				next_attempt_at datetime NOT NULL,
				result_category varchar(40) NOT NULL DEFAULT '',
				meta_error_code varchar(40) NOT NULL DEFAULT '',
				meta_error_type varchar(80) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY logical_conversion (transaction_id,event_name),
				UNIQUE KEY delivery_event (event_id),
				KEY due (state,next_attempt_at),
				KEY claims (state,claim_expires_at),
				KEY retention (updated_at)
			) {$charset};"
		);
		$column = $wpdb->get_row( $wpdb->prepare( 'SHOW COLUMNS FROM %i LIKE %s', $table, 'transaction_id' ) );
		if ( $column && 'NO' === $column->Null ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- MySQL column name.
			$wpdb->query( $wpdb->prepare( 'ALTER TABLE %i MODIFY transaction_id bigint(20) unsigned DEFAULT NULL', $table ) );
		}
		$wpdb->query( $wpdb->prepare( "UPDATE %i SET claim_expires_at = %s WHERE state = 'sending' AND claim_expires_at IS NULL", $table, self::lease_end() ) );
		DeliveryAttempts::install();
		update_option( 'fair_events_experimental_meta_db_version', self::DB_VERSION );
	}

	/**
	 * Queue an event once. Engagement events omit `transaction_id` and carry
	 * `event_post_id`/`event_date_id`; a zero or missing ID is stored as NULL,
	 * and so is a missing or empty `event_context`.
	 *
	 * @param array $event Event data. @return bool Whether a new row was queued.
	 */
	public function enqueue( $event ) {
		return $this->insert( $event, 'pending' );
	}

	/**
	 * Reserve an engagement event for an immediate send in the request that
	 * captured it. The unique `event_id` makes the reservation atomic: a
	 * duplicate — including a replay of an activation queued before
	 * immediate delivery existed — inserts nothing, so only one request ever
	 * sends. The row is never pending work, and Meta browser identifiers
	 * and the browser User-Agent stay in memory: none are stored.
	 *
	 * @param array $event {@see Conversions::build_engagement_event()} result.
	 * @return bool Whether this request reserved the event and may send it.
	 */
	public function reserve_immediate( $event ) {
		$event['fbp'] = '';
		$event['fbc'] = '';
		unset( $event['client_user_agent'] );
		return $this->insert( $event, self::IMMEDIATE_SENDING );
	}

	/**
	 * Store the terminal outcome of a reserved immediate send as
	 * `immediate_<outcome>`. It is never retried.
	 *
	 * @param string $event_id Reserved Meta event ID.
	 * @param array  $result   {@see Conversions::send_payload()} result.
	 */
	public function finish_immediate( $event_id, $result ) {
		global $wpdb;
		$outcome = sanitize_key( (string) $result['outcome'] );
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET state = %s, result_category = %s, attempt_count = 1, meta_error_code = %s, meta_error_type = %s, meta_diagnostics = %s, updated_at = %s WHERE event_id = %s AND state = %s',
				self::table_name(),
				'immediate_' . $outcome,
				$outcome,
				sanitize_key( (string) $result['code'] ),
				sanitize_key( (string) $result['type'] ),
				self::encode_diagnostics( $result['diagnostics'] ?? null ),
				current_time( 'mysql', true ),
				$event_id,
				self::IMMEDIATE_SENDING
			)
		);
	}

	/**
	 * @param array  $event Event data.
	 * @param string $state Initial state.
	 * @return bool Whether a new row was inserted.
	 */
	private function insert( $event, $state ) {
		global $wpdb;
		$now               = current_time( 'mysql', true );
		$result            = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO %i (transaction_id,event_post_id,event_date_id,event_name,event_id,event_time,source_url,value,currency,order_id,payment_mode,fbp,fbc,event_context,state,next_attempt_at,created_at,updated_at) VALUES (NULLIF(%d,0),NULLIF(%d,0),NULLIF(%d,0),%s,%s,%d,%s,%f,%s,%s,%s,%s,%s,NULLIF(%s,''),%s,%s,%s,%s)",
				self::table_name(),
				$event['transaction_id'] ?? 0,
				$event['event_post_id'] ?? 0,
				$event['event_date_id'] ?? 0,
				$event['event_name'],
				$event['event_id'],
				$event['event_time'],
				$event['source_url'],
				$event['value'],
				$event['currency'],
				$event['order_id'],
				$event['payment_mode'],
				$event['fbp'],
				$event['fbc'],
				$event['event_context'] ?? '',
				$state,
				$now,
				$now,
				$now
			)
		);
		$inserted          = false !== $result && $result > 0;
		$this->inserted_id = $inserted && isset( $wpdb->insert_id ) ? (int) $wpdb->insert_id : 0;
		return $inserted;
	}

	/** @return int ID of the row this instance last queued or reserved, or 0. */
	public function inserted_id() {
		return $this->inserted_id;
	}

	/**
	 * Atomically claim the next due row, or recover a queued claim whose
	 * lease expired because its worker was interrupted. The claim gets a
	 * unique token and a {@see LEASE_SECONDS} lease, and counts as an
	 * attempt straight away, so repeated interruptions cannot bypass
	 * {@see MAX_ATTEMPTS}. `immediate_*` rows are never claimed.
	 *
	 * A row another worker claimed first is skipped; after
	 * {@see CLAIM_TRIES} such losses this returns null with
	 * {@see contended()} set, although due work may remain.
	 *
	 * @return object|null Claimed row, with its `claim_token`.
	 */
	public function claim_due() {
		global $wpdb;
		$table           = self::table_name();
		$this->contended = false;
		for ( $try = 0; $try < self::CLAIM_TRIES; $try++ ) {
			$now = current_time( 'mysql', true );
			$id  = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM %i WHERE state IN ('pending','retry_pending') AND next_attempt_at <= %s ORDER BY next_attempt_at,id LIMIT 1", $table, $now ) );
			if ( ! $id ) {
				$id = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM %i WHERE state = 'sending' AND claim_expires_at <= %s AND attempt_count < %d ORDER BY claim_expires_at,id LIMIT 1", $table, $now, self::MAX_ATTEMPTS ) );
			}
			if ( ! $id ) {
				return null;
			}
			$token   = bin2hex( random_bytes( 16 ) );
			$claimed = $wpdb->query(
				$wpdb->prepare(
					"UPDATE %i SET state = 'sending', claim_token = %s, claim_expires_at = %s, attempt_count = attempt_count + 1, updated_at = %s WHERE id = %d AND ( ( state IN ('pending','retry_pending') AND next_attempt_at <= %s ) OR ( state = 'sending' AND claim_expires_at <= %s AND attempt_count < %d ) )",
					$table,
					$token,
					self::lease_end(),
					$now,
					$id,
					$now,
					$now,
					self::MAX_ATTEMPTS
				)
			);
			if ( 1 === $claimed ) {
				return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d AND claim_token = %s', $table, $id, $token ) );
			}
			$this->contended = true;
		}
		return null;
	}

	/** @return bool Whether the last {@see claim_due()} lost every candidate to other workers. */
	public function contended() {
		return $this->contended;
	}

	/**
	 * Finish interrupted claims that used their last attempt as
	 * `retries_exhausted`, with the `interrupted` category, once their lease
	 * expired. They are never sent again.
	 */
	public function expire_exhausted_claims() {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET state = 'retries_exhausted', result_category = 'interrupted', meta_error_code = '', meta_error_type = 'interrupted', meta_diagnostics = NULL, fbp = NULL, fbc = NULL, claim_token = NULL, claim_expires_at = NULL, updated_at = %s WHERE state = 'sending' AND claim_expires_at <= %s AND attempt_count >= %d",
				self::table_name(),
				$now,
				$now,
				self::MAX_ATTEMPTS
			)
		);
	}

	/**
	 * When outstanding queued work next needs a worker: the earliest due or
	 * retrying row, or the earliest claim lease to expire.
	 *
	 * @return int|null Unix timestamp, possibly past, or null without work.
	 */
	public function next_wake_at() {
		global $wpdb;
		$table = self::table_name();
		$times = array(
			$wpdb->get_var( $wpdb->prepare( "SELECT MIN(next_attempt_at) FROM %i WHERE state IN ('pending','retry_pending')", $table ) ),
			$wpdb->get_var( $wpdb->prepare( "SELECT MIN(claim_expires_at) FROM %i WHERE state = 'sending'", $table ) ),
		);
		$times = array_filter(
			array_map(
				static fn( $time ) => is_string( $time ) && preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $time ) ? strtotime( $time . ' UTC' ) : false,
				$times
			)
		);
		return $times ? (int) min( $times ) : null;
	}

	/**
	 * Store a claimed row's terminal outcome. Only the worker still holding
	 * the claim may write it: a row recovered by another worker is left to
	 * that worker.
	 *
	 * @param object     $row      Claimed row.
	 * @param string     $category Safe result category.
	 * @param string     $code     Safe Meta code.
	 * @param string     $type     Safe Meta type.
	 * @param array|null $diagnostics Allowlisted diagnostics.
	 * @return bool Whether the claim was still held and the outcome stored.
	 */
	public function finish( $row, $category, $code = '', $type = '', $diagnostics = null ) {
		return $this->update_claimed(
			$row,
			array(
				'state'            => $category,
				'result_category'  => $category,
				'meta_error_code'  => sanitize_key( $code ),
				'meta_error_type'  => sanitize_key( $type ),
				'meta_diagnostics' => self::encode_diagnostics( $diagnostics ),
				'fbp'              => null,
				'fbc'              => null,
				'claim_token'      => null,
				'claim_expires_at' => null,
				'updated_at'       => current_time( 'mysql', true ),
			)
		);
	}

	/**
	 * Schedule a claimed row's next attempt, or finish it as
	 * `retries_exhausted` after {@see MAX_ATTEMPTS}. The claim already
	 * counted this attempt. The worker reconciles the delivery schedule when
	 * it finishes, so nothing is scheduled here.
	 *
	 * @param object     $row      Claimed row.
	 * @param string     $code     Safe code.
	 * @param string     $type     Safe type.
	 * @param string     $category `temporary_error`, or `unconfirmed` when Meta answered without confirming the event.
	 * @param array|null $diagnostics Allowlisted diagnostics.
	 * @return bool Whether the claim was still held and the outcome stored.
	 */
	public function retry( $row, $code = '', $type = '', $category = 'temporary_error', $diagnostics = null ) {
		$attempts = max( 1, (int) $row->attempt_count );
		if ( $attempts >= self::MAX_ATTEMPTS ) {
			return $this->finish( $row, 'retries_exhausted', $code, $type, $diagnostics );
		}
		return $this->update_claimed(
			$row,
			array(
				'state'            => 'retry_pending',
				'result_category'  => $category,
				'next_attempt_at'  => gmdate( 'Y-m-d H:i:s', time() + self::RETRY_DELAYS[ $attempts - 1 ] ),
				'meta_error_code'  => sanitize_key( $code ),
				'meta_error_type'  => sanitize_key( $type ),
				'meta_diagnostics' => self::encode_diagnostics( $diagnostics ),
				'claim_token'      => null,
				'claim_expires_at' => null,
				'updated_at'       => current_time( 'mysql', true ),
			)
		);
	}

	/**
	 * @param object $row  Claimed row.
	 * @param array  $data Columns to write; every value is a string or null.
	 * @return bool Whether exactly the claimed row was updated.
	 */
	private function update_claimed( $row, $data ) {
		global $wpdb;
		$updated = $wpdb->update(
			self::table_name(),
			$data,
			array(
				'id'          => (int) $row->id,
				'state'       => 'sending',
				'claim_token' => (string) ( $row->claim_token ?? '' ),
			),
			array_fill( 0, count( $data ), '%s' ),
			array( '%d', '%s', '%s' )
		);
		return 1 === $updated;
	}

	/** @return string UTC end of a lease taken now. */
	private static function lease_end() {
		return gmdate( 'Y-m-d H:i:s', time() + self::LEASE_SECONDS );
	}

	/** @return array */
	public function diagnostics() {
		global $wpdb;
		$table  = self::table_name();
		$counts = $wpdb->get_results( $wpdb->prepare( 'SELECT state, COUNT(*) AS total FROM %i GROUP BY state', $table ), OBJECT_K );
		$recent = $wpdb->get_results( $wpdb->prepare( 'SELECT id,event_name,state,result_category,attempt_count,meta_error_code,meta_error_type,meta_diagnostics,payment_mode,updated_at FROM %i ORDER BY updated_at DESC LIMIT 20', $table ), ARRAY_A );
		$recent = $recent ? $recent : array();
		$logged = ( new DeliveryAttempts() )->counts_for_outbox( array_column( $recent, 'id' ) );
		foreach ( $recent as &$row ) {
			$row['logged_attempts'] = $logged[ (int) $row['id'] ] ?? 0;
			unset( $row['id'] );
		}
		unset( $row );
		return array(
			'counts' => array_map( static fn( $row ) => (int) $row->total, $counts ? $counts : array() ),
			'recent' => array_map( array( $this, 'with_local_time' ), $recent ),
		);
	}

	/**
	 * Add a site-local, formatted display time alongside the raw UTC
	 * `updated_at` — the raw value stays for ordering/machine use, the
	 * formatted one respects the site's timezone and date/time settings.
	 * Also casts `attempt_count`, which `wpdb` otherwise returns as a numeric
	 * string, breaking JS plural-form selection (`_n()` treats `'1'` as
	 * plural). Stored Meta diagnostics are merged in by their allowlisted
	 * keys; rows finished before they were stored carry none of those keys.
	 *
	 * @param array $row Diagnostic row with a UTC `updated_at`.
	 * @return array
	 */
	private function with_local_time( $row ) {
		$diagnostics = isset( $row['meta_diagnostics'] ) ? json_decode( (string) $row['meta_diagnostics'], true ) : null;
		unset( $row['meta_diagnostics'] );
		if ( is_array( $diagnostics ) ) {
			foreach ( self::DIAGNOSTIC_KEYS as $key ) {
				$row[ $key ] = $diagnostics[ $key ] ?? null;
			}
		}
		$row['attempt_count']    = (int) $row['attempt_count'];
		$row['updated_at_local'] = wp_date(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			strtotime( $row['updated_at'] . ' UTC' )
		);
		return $row;
	}

	/** @param array|null $diagnostics Diagnostics. @return string|null Allowlisted JSON, or null without diagnostics. */
	private static function encode_diagnostics( $diagnostics ) {
		if ( ! is_array( $diagnostics ) ) {
			return null;
		}
		$allowed = array();
		foreach ( self::DIAGNOSTIC_KEYS as $key ) {
			$allowed[ $key ] = $diagnostics[ $key ] ?? null;
		}
		return (string) wp_json_encode( $allowed );
	}

	/** Purge all rows older than the retention ceiling. */
	public function cleanup() {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s', self::table_name(), gmdate( 'Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS ) ) );
	}
}
